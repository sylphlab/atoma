import { Atom, Getter, AtomContext, AtomInitializer, AtomModelDefinition, AtomFamilyTemplate, isFamilyAtomTemplate, AtomActions } from './types.js';

// Symbol for internal store reference in actions
const STORE_REF = Symbol('storeRef');

/**
 * Manages the state of atoms and their dependencies.
 */
export class Store {
    private atomCache = new Map<symbol, Atom<any>>(); // Cache for ALL atom instances (including family instances)
    private familyCache = new Map<symbol, Map<string, Atom<any>>>(); // Cache for family instances { familyTemplateId -> { paramKey -> instanceAtom } }
    private currentlyBuilding = new Set<symbol>(); // Track atoms currently being built to detect circular dependencies
    private buildStack: Atom<any>[] = []; // Track the stack of atoms being built for dependency tracking

    /**
     * Retrieves the current value of an atom.
     * Handles sync, async, computed, stream, and model-like atoms transparently.
     * For async/stream atoms, this might trigger the operation or return the last known value.
     * UI integrations should handle loading/error states.
     */
    get<T>(atom: Atom<T>): T {
        const instance = this.resolveAtomInstance(atom);

        // Dependency Tracking: If called within another atom's build, register dependency
        if (this.buildStack.length > 0) {
            const dependent = this.buildStack[this.buildStack.length - 1];
            this.registerDependency(dependent, instance);
        }

        // Check if atom needs building/rebuilding
        // TODO: Add more sophisticated dirty checking later
        if (instance._value === undefined && instance._promise === undefined && instance._error === undefined) {
             // Never built or invalidated
            this.buildAtom(instance);
        }

        // Handle state
        if (instance._error !== undefined) {
            throw instance._error; // Propagate error
        }
        if (instance._promise !== undefined) {
            // For sync get, throw the promise (Suspense integration)
            // Or handle differently based on environment (e.g., return undefined in Node)
            // For now, we'll throw to align with potential Suspense usage
            throw instance._promise;
        }
        if (instance._value !== undefined) {
            // Ensure value is not undefined before returning, although prior checks should handle this.
            // Cast to T as the logic guarantees it's the correct type if defined.
            return instance._value as T;
        }

        // Should ideally not reach here if buildAtom was called, but handle static atoms
        if (typeof instance._init !== 'function') {
             instance._value = instance._init as T;
             // Static initializer value is assigned directly. Cast to T.
             return instance._value as T;
        }

        // If it's a function-based atom that somehow wasn't built (e.g., error during initial build?)
        throw new Error(`Atom ${String(instance._id)} could not be resolved.`);
    }

    /**
     * Sets the value of a writable atom.
     * Throws an error if the atom is read-only or has actions (use `use` for models).
     */
    set<T>(atom: Atom<T>, value: T | ((prev: T) => T)): void {
        const instance = this.resolveAtomInstance(atom);

        if (typeof instance._init === 'object' && instance._init !== null && 'actions' in instance._init) {
            throw new Error('Cannot set model-like atom directly. Use store.use(atom).actionName().');
        }
        if (typeof instance._init === 'function' && !('_updater' in instance._init)) { // Check if it's a computed atom without a setter
             // TODO: Add support for writable computed atoms later
            throw new Error('Cannot set read-only computed atom.');
        }

        const oldValue = instance._value;
        const newValue = typeof value === 'function'
            ? (value as (prev: T) => T)(oldValue as T)
            : value;

        if (oldValue !== newValue) {
            instance._value = newValue;
            // TODO: Clear async state if set directly?
            instance._promise = undefined;
            instance._error = undefined;
            this.notifySubscribers(instance);
            this.propagateChanges(instance);
        }
    }

    /**
     * Subscribes to changes in an atom's value.
     * Returns an unsubscribe function. The callback receives the value or undefined, and an optional error.
     */
    on<T>(atom: Atom<T>, callback: (value?: T, error?: unknown) => void): () => void {
        const instance = this.resolveAtomInstance(atom);
        if (!instance._subscribers) {
            // Explicitly type the Set when creating it
            instance._subscribers = new Set<(value?: T, error?: unknown) => void>();
        }
        // The callback type matches the Set type now
        instance._subscribers.add(callback);

        // Trigger initial build if it hasn't happened yet and has subscribers
        if (instance._value === undefined && instance._promise === undefined && instance._error === undefined) {
            this.buildAtom(instance);
        }

        return () => {
            const subscribers = instance._subscribers;
            if (subscribers) {
                // The callback type matches the Set type now
                subscribers.delete(callback);
                if (subscribers.size === 0) {
                    // Optional: Teardown logic when no subscribers are left
                    this.maybeTeardownAtom(instance);
                }
            }
        };
    }

    /**
     * Retrieves the actions API for a model-like atom.
     */
    use<TAtom extends Atom<any>>(atom: TAtom): AtomActions<TAtom> {
        const instance = this.resolveAtomInstance(atom);
        const definition = instance._init as AtomModelDefinition<any, any>;

        if (typeof definition !== 'object' || definition === null || !('actions' in definition)) {
            throw new Error('Atom does not have actions defined. Use store.get() or store.set() instead.');
        }

        // Cache the bound actions API
        if (!instance._actionsApi) {
            instance._actionsApi = {} as AtomActions<TAtom>;
            for (const actionName in definition.actions) {
                const actionFn = definition.actions[actionName];
                (instance._actionsApi as any)[actionName] = async (...args: any[]) => {
                    // TODO: Handle state updates based on action return value (sync or async)
                    const currentState = this.get(instance); // Get current state before action
                    try {
                        const result = await actionFn(currentState, ...args);
                        // If action returns a new state, update the atom
                        if (result !== undefined) { // Allow actions to not return state if they mutate elsewhere or are just triggers
                             // Use internal set to bypass writability checks
                            this.internalSetState(instance, result);
                        }
                        return result; // Return action result if any
                    } catch (error) { 
                        console.error(`Error in action '${actionName}' for atom ${String(instance._id)}:`, error);
                        // Optionally update atom state with error?
                        throw error; // Re-throw error
                    }
                };
            }
        }
        return instance._actionsApi;
    }

    // --- Internal Methods ---

    private internalSetState<T>(instance: Atom<T>, newState: T): void {
        if (instance._value !== newState) {
            instance._value = newState;
            instance._promise = undefined; // Clear async state on direct update
            instance._error = undefined;
            this.notifySubscribers(instance);
            this.propagateChanges(instance);
        }
    }

    /** Resolves a regular atom instance, ensuring it's not a family template */
    private resolveAtomInstance<T>(atom: Atom<T>): Atom<T> {
        // Check if it's a family template passed incorrectly
        if (isFamilyAtomTemplate(atom)) {
             throw new Error(`Cannot directly use an AtomFamilyTemplate [${String(atom._id)}]. Use atomFamily(...) to create instances.`);
        }

        // Check if it's already cached
        if (this.atomCache.has(atom._id)) {
            return this.atomCache.get(atom._id)!;
        }

        // If not cached, it's a new regular atom. Cache and return it.
        this.atomCache.set(atom._id, atom);
        return atom;


        // Note: The previous logic involving _isFamily is removed as atom() no longer creates families.
    }

    /** Resolves or creates an instance of an atom from a family template */
    resolveFamilyInstance<T, P>(familyTemplate: AtomFamilyTemplate<T, P>, param: P): Atom<T> {
        const familyId = familyTemplate._id;
        const paramKey = JSON.stringify(param); // Simple serialization for key

        if (!this.familyCache.has(familyId)) {
            this.familyCache.set(familyId, new Map());
        }
        const instances = this.familyCache.get(familyId)!;

        if (!instances.has(paramKey)) {
            // Create a new atom instance for this parameter
            const instanceId = Symbol(`${String(familyId)}_${paramKey}`);
            const instance: Atom<T> = {
                // Create the actual AtomInitializer using the template's function
                _init: familyTemplate._init(param),
                _id: instanceId,
                // _isFamily removed
                _lastParam: param, // Store param for potential debugging/re-evaluation
                // Reset instance-specific state
                _subscribers: undefined,
                _dependents: undefined,
                _dependencies: undefined,
                _value: undefined,
                _promise: undefined,
                _error: undefined,
                _streamController: undefined,
                _actionsApi: undefined,
            };
            instances.set(paramKey, instance);
            this.atomCache.set(instanceId, instance); // Also add to global atom cache
            // console.log(`Created family instance: ${String(instanceId)}`);
        }

        return instances.get(paramKey)!;
    }

    private buildAtom<T>(instance: Atom<T>): void {
        // Detect circular dependencies
        if (this.currentlyBuilding.has(instance._id)) {
            const path = [...this.buildStack.map(a => String(a._id)), String(instance._id)].join(' -> ');
            throw new Error(`Circular dependency detected: ${path}`);
        }
        this.currentlyBuilding.add(instance._id);
        this.buildStack.push(instance);

        // Clear previous dependencies before rebuilding
        this.clearDependencies(instance);

        // Reset state before build
        instance._promise = undefined;
        instance._error = undefined;
        // Keep previous value for comparison? Or clear it? Let's clear for now.
        // instance._value = undefined;

        let newValue: T | undefined;
        let newPromise: Promise<T> | undefined;
        let newError: unknown | undefined;

        try {
            const init = instance._init;
            let buildFn: Function | undefined;
            let isModel = false;

            if (typeof init === 'object' && init !== null && 'build' in init) {
                buildFn = init.build as Function;
                isModel = true;
            } else if (typeof init === 'function') {
                buildFn = init;
            }

            if (buildFn) {
                const getter: Getter = <D>(dep: Atom<D>) => { // Added type annotation
                    // Note: Dependency registration happens in the `get` method itself
                    return this.get(dep);
                };
                const context: AtomContext = {
                    get: getter,
                    // Ensure watch callback signature matches 'on'
                    watch: <D>(dep: Atom<D>, cb: (value?: D, error?: unknown) => void) => this.on(dep, cb),
                    invalidate: () => this.invalidateAtom(instance),
                    // TODO: Add signal, keepalive etc.
                };

                // Execute the build function, passing the correct argument based on arity
                let result: T | Promise<T> | AsyncIterable<T>;
                if (buildFn.length === 1) {
                     // Assume it expects the getter directly (e.g., get => ...)
                     result = buildFn(getter);
                } else {
                     // Assume it expects the full context (e.g., context => ..., () => ..., async () => ...)
                     result = buildFn(context);
                }

                // Type checks must be ordered carefully
                if (result instanceof Promise) {
                    newPromise = result;
                    instance._promise = newPromise; // Set promise immediately
                    result
                        .then(value => {
                            // Only update if the promise is still the current one
                            if (instance._promise === newPromise) {
                                this.updateAtomState(instance, value, undefined, undefined);
                            }
                        })
                        .catch(error => {
                            if (instance._promise === newPromise) {
                                this.updateAtomState(instance, undefined, undefined, error);
                            }
                        });
                } else if (typeof result === 'object' && result !== null && typeof (result as any)[Symbol.asyncIterator] === 'function') {
                    // Handle Async Iterables (must come before general object check)
                    // Handle Async Iterables
                    console.log(`Starting AsyncIterable for atom ${String(instance._id)}`);
                    instance._streamController?.abort(); // Abort previous iteration if any
                    const controller = new AbortController();
                    instance._streamController = controller;

                    // IIAFE to handle the async iteration
                    (async () => {
                        try {
                            for await (const value of result as AsyncIterable<T>) {
                                if (controller.signal.aborted) {
                                    console.log(`AsyncIterable aborted for atom ${String(instance._id)}`);
                                    return; // Stop iteration if aborted
                                }
                                // console.log(`Atom ${String(instance._id)} received AsyncIterable value:`, value);
                                this.updateAtomState(instance, value, undefined, undefined);
                            }
                            // Iteration completed successfully
                            if (!controller.signal.aborted) {
                                console.log(`AsyncIterable completed for atom ${String(instance._id)}`);
                                instance._streamController = undefined; // Clear controller on completion
                            }
                        } catch (error) {
                            if (!controller.signal.aborted) {
                                console.error(`Error in AsyncIterable for atom ${String(instance._id)}:`, error);
                                this.updateAtomState(instance, undefined, undefined, error);
                                instance._streamController = undefined; // Clear controller on error
                            }
                        }
                    })();

                    // Add cleanup for abort signal
                    // Note: There isn't a direct way to interrupt a for await...of loop externally
                    // other than checking the signal within the loop or potentially closing the iterator if possible.
                    // The AbortController here primarily signals intent and stops updates.
                    // A more robust solution might involve wrapping the iterator.
                    controller.signal.addEventListener('abort', () => {
                         console.log(`Abort signal received for AsyncIterable on atom ${String(instance._id)}`);
                         // Attempt cleanup if the iterable source supports it (e.g., closing a connection)
                         // This depends heavily on the specific AsyncIterable implementation.
                        });
                        // Initial state is likely undefined until the first value arrives.
                    } else if (typeof result === 'object' && result !== null && typeof (result as any).subscribe === 'function') {
                        // Handle Observable-like streams (must come before general object check)
                    // Handle Observable-like streams
                    console.log(`Subscribing to Observable for atom ${String(instance._id)}`);
                    // Ensure previous stream is cleaned up if rebuilding
                    instance._streamController?.abort(); // Abort previous subscription if any
                    const controller = new AbortController();
                    instance._streamController = controller;

                    // Assume a simple Observable-like structure with subscribe returning an unsubscribe function or object
                    const subscription = (result as any).subscribe({
                        next: (value: T) => {
                            if (!controller.signal.aborted) {
                                // console.log(`Atom ${String(instance._id)} received stream value:`, value);
                                this.updateAtomState(instance, value, undefined, undefined);
                            }
                        },
                        error: (error: unknown) => {
                            if (!controller.signal.aborted) {
                                console.error(`Error in stream for atom ${String(instance._id)}:`, error);
                                this.updateAtomState(instance, undefined, undefined, error);
                                instance._streamController = undefined; // Clear controller on error
                            }
                        },
                        complete: () => {
                            if (!controller.signal.aborted) {
                                console.log(`Stream completed for atom ${String(instance._id)}`);
                                // Keep the last value, but clear the controller? Or mark as completed?
                                instance._streamController = undefined; // Clear controller on completion
                            }
                        }
                    });

                    // Store cleanup logic (might be a function or an object with unsubscribe)
                    if (typeof subscription === 'function') {
                        instance._streamController.signal.addEventListener('abort', subscription);
                    } else if (subscription && typeof subscription.unsubscribe === 'function') {
                        instance._streamController.signal.addEventListener('abort', () => subscription.unsubscribe());
                    }
                    // Initial state might be undefined until first emission
                    // Set initial state only if not already set by sync path?
                    if (instance._value === undefined && instance._promise === undefined && instance._error === undefined) {
                         // Indicate loading or initial state? For now, leave value undefined until first emission.
                         // Or potentially set an initial value if provided?
                    }
                } else if (typeof (result as any)?.then === 'function') {
                     // Handle other thenables AFTER specific object types (Promise, AsyncIterable, Observable)
                     // Cast result to avoid TS errors, as we've excluded other known object types
                     newPromise = Promise.resolve(result as Promise<T>);
                     instance._promise = newPromise;
                     newPromise.then(value => {
                         if (instance._promise === newPromise) this.updateAtomState(instance, value, undefined, undefined);
                     }).catch(error => {
                         if (instance._promise === newPromise) this.updateAtomState(instance, undefined, undefined, error);
                     });
                }
                 else {
                    // Synchronous result (must be of type T after excluding Promise, AsyncIterable, Observable, Thenable)
                    newValue = result as T;
                }
            } else if (!isModel) {
                // Static value atom (already handled in get, but as fallback)
                newValue = init as T;
            } else {
                 // Model without a build function? Should have been caught earlier.
                 throw new Error(`Invalid model definition for atom ${String(instance._id)}`);
            }

            // Update state only if it's a synchronous result (newValue is set and not handled by async/stream/thenable)
            if (newValue !== undefined && newPromise === undefined && instance._streamController === undefined) {
                 this.updateAtomState(instance, newValue, undefined, undefined);
            }

        } catch (error) {
            newError = error;
            this.updateAtomState(instance, undefined, undefined, newError);
        } finally {
            this.currentlyBuilding.delete(instance._id);
            this.buildStack.pop();
        }
    }

    /** Helper to update atom state and notify */
    private updateAtomState<T>(instance: Atom<T>, value: T | undefined, promise: Promise<T> | undefined, error: unknown | undefined) {
        const valueChanged = value !== undefined && instance._value !== value;
        const promiseChanged = instance._promise !== promise;
        const errorChanged = instance._error !== error;

        instance._value = value;
        instance._promise = promise;
        instance._error = error;

        if (valueChanged || promiseChanged || errorChanged) {
             // Only notify if state actually changed
            this.notifySubscribers(instance);
            // Only propagate if value changed (or maybe error status changed?)
            if (valueChanged || errorChanged) {
                 this.propagateChanges(instance);
            }
        }
    }

    private invalidateAtom<T>(instance: Atom<T>) {
         // Mark atom as dirty, forcing rebuild on next get
         // More sophisticated: only rebuild if subscribed or depended upon
         console.log(`Invalidating atom: ${String(instance._id)}`);
         instance._value = undefined;
         instance._promise = undefined;
         instance._error = undefined;
         // Rebuild dependents immediately? Or lazily on next get? Let's try lazy for now.
         this.propagateInvalidation(instance);
         // Notify subscribers that the value might be stale (or trigger rebuild?)
         // this.notifySubscribers(instance); // Maybe not notify until rebuild?
    }

    private propagateInvalidation(invalidatedAtom: Atom<any>) {
         invalidatedAtom._dependents?.forEach((dependent: Atom<any>) => {
              if (dependent._value !== undefined || dependent._promise !== undefined || dependent._error !== undefined) {
                   this.invalidateAtom(dependent); // Recursively invalidate dependents
              }
         });
    }

    private registerDependency(dependent: Atom<any>, dependency: Atom<any>) {
        if (!dependent._dependencies) {
            dependent._dependencies = new Set();
        }
        dependent._dependencies.add(dependency);

        if (!dependency._dependents) {
            dependency._dependents = new Set();
        }
        dependency._dependents.add(dependent);
        // console.log(`${String(dependent._id)} now depends on ${String(dependency._id)}`);
    }

    private clearDependencies(atom: Atom<any>) {
        atom._dependencies?.forEach((dep: Atom<any>) => {
            dep._dependents?.delete(atom);
        });
        atom._dependencies = undefined; // Clear old dependencies
    }

    private maybeTeardownAtom(instance: Atom<any>) {
         // If atom has no subscribers and no dependents, potentially clean it up
         const noSubscribers = !instance._subscribers || instance._subscribers.size === 0;
         const noDependents = !instance._dependents || instance._dependents.size === 0;

         if (noSubscribers && noDependents) {
              console.log(`Tearing down atom ${String(instance._id)}`);
              // Cancel ongoing streams/async operations
              instance._streamController?.abort();
              instance._streamController = undefined;
              // TODO: Cancel promises? More complex.
              // TODO: Remove from caches? (atomCache, familyCache) - needs careful handling for families
              this.clearDependencies(instance); // Clean up dependency links
         }
    }

    private notifySubscribers<T>(instance: Atom<T>): void {
        // TODO: Debounce or schedule notifications?
        // Explicitly define the callback type for forEach
        // Ensure the callback type matches the Set's type
        instance._subscribers?.forEach((callback) => {
            try {
                // Pass both value and error to the subscriber
                callback(instance._value, instance._error);
            } catch (err) { 
                console.error("Error in subscriber:", err);
            }
        });
    }

    private propagateChanges(changedAtom: Atom<any>): void {
        // When an atom's value changes, its dependents might need recalculating.
        changedAtom._dependents?.forEach((dependent: Atom<any>) => {
            // Invalidate dependent - it will rebuild on next access or if subscribed
            this.invalidateAtom(dependent);
            // If the dependent has active subscribers, trigger rebuild immediately?
            // Or rely on UI layer calling get again? Let's try immediate rebuild if subscribed.
            if (dependent._subscribers && dependent._subscribers.size > 0) {
                 console.log(`Rebuilding subscribed dependent: ${String(dependent._id)}`);
                 this.buildAtom(dependent);
            }
        });
    }

    // TODO: Add methods for cleanup, disposing atoms/families, etc.
}

// Default global store instance
let defaultStore: Store | null = null;

export function getDefaultStore(): Store {
    if (!defaultStore) {
        defaultStore = new Store();
    }
    return defaultStore;
}
