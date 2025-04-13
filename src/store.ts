import { Atom, Getter, AtomContext, AtomInitializer, AtomModelDefinition, AtomFamilyTemplate, isFamilyAtomTemplate, AtomActions, WritableComputedAtomDefinition, Setter, AtomState } from './types.js';

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

        // Check if atom needs building/rebuilding based on state
        if (instance._state === 'idle' || instance._state === 'dirty') {
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

        // Handle static atoms specifically if they are still idle after potential build call
        // (buildAtom handles setting state for function-based atoms)
        if (instance._state === 'idle' && typeof instance._init !== 'function') {
             instance._value = instance._init as T;
             instance._state = 'valid'; // Mark static atom as valid after assigning value
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

        const init = instance._init;

        // Check if it's a model-like atom
        if (typeof init === 'object' && init !== null && 'actions' in init && 'build' in init) {
            throw new Error('Cannot set model-like atom directly. Use store.use(atom).actionName().');
        }

        // Check if it's a writable computed atom
        if (typeof init === 'object' && init !== null && 'get' in init && 'set' in init) {
            const writableDef = init as WritableComputedAtomDefinition<T>;
            const setterContext = {
                get: <D>(dep: Atom<D>) => this.get(dep),
                set: <D>(dep: Atom<D>, val: D | ((prev: D) => D)) => this.set(dep, val)
            };
            // Calculate the actual value to pass to the setter
             const newValueToSet = typeof value === 'function'
                ? (value as (prev: T) => T)(this.get(instance)) // Pass current value to updater fn
                : value;
            writableDef.set(setterContext, newValueToSet);
            // The setter function is responsible for updating underlying atoms and triggering notifications.
            // We don't directly modify the instance._value here for computed atoms.
            return; // Exit after calling the setter
        }

        // Check if it's a read-only computed atom (function initializer)
        if (typeof init === 'function') {
            throw new Error('Cannot set read-only computed atom.');
        }

        // If none of the above, it must be a simple static atom

        const oldValue = instance._value;
        const newValue = typeof value === 'function'
            ? (value as (prev: T) => T)(oldValue as T)
            : value;

        if (oldValue !== newValue) {
            instance._value = newValue;
            instance._promise = undefined; // Clear async state if set directly
            instance._error = undefined;
            instance._state = 'valid'; // Mark as valid after direct set
            this.notifySubscribers(instance);
            this.propagateChanges(instance);
        }
    }

    /**
     * Subscribes to changes in an atom's value.
     * Returns an unsubscribe function. The callback receives the value or undefined, and an optional error.
     */
    // Use Atom<any> for the input parameter to accept various atom types from overloads
    on<T>(atom: Atom<any>, callback: (value?: T, error?: unknown) => void): () => void {
        // Resolve the instance as before, but cast it internally if needed
        const instance = this.resolveAtomInstance(atom) as Atom<T>;
        if (!instance._subscribers) {
            // Explicitly type the Set when creating it, using the inferred T
            instance._subscribers = new Set<(value?: T, error?: unknown) => void>();
        }
        // Cast the callback before adding to the Set to ensure compatibility
        instance._subscribers.add(callback);

        // Trigger initial build ONLY if atom is idle (never built)
        if (instance._state === 'idle') {
             this.buildAtom(instance);
             // Note: buildAtom -> updateAtomState -> notifySubscribers will call the callback
        } else if (instance._state === 'valid' || instance._state === 'error') {
             // If atom is already resolved (valid or error), notify the new subscriber immediately.
             // Do NOT notify immediately if state is 'pending', 'building', or 'dirty'.
             try {
                 callback(instance._value, instance._error);
             } catch (err) {
                 console.error("Error in initial subscriber notification:", err);
             }
        }

        return () => {
            const subscribers = instance._subscribers;
            if (subscribers) {
                // Cast the callback before deleting from the Set
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
    // Reverted 'use' method signature to be more general, relying on internal checks
    use<TAtom extends Atom<any>>(atom: TAtom): AtomActions<TAtom> {
        const instance = this.resolveAtomInstance(atom);
        const definition = instance._init; // Get the initializer

        // Perform runtime check to ensure it's a valid model definition
        if (typeof definition !== 'object' || definition === null || !('actions' in definition) || !('build' in definition) || typeof (definition as any).actions !== 'object' || (definition as any).actions === null) {
            throw new Error('Atom is not a valid model-like atom with actions. Use store.get() or store.set() instead.');
        }

        // Cast to the specific model definition type *after* the check
        const modelDefinition = definition as AtomModelDefinition<any, Record<string, (state: any, ...args: any[]) => any>>;

        // Cache the bound actions API
        if (!instance._actionsApi) {
            // Use 'any' for the initial object and rely on the final return type assertion
            const actionsApi: any = {};
            for (const actionName in modelDefinition.actions) {
                if (Object.prototype.hasOwnProperty.call(modelDefinition.actions, actionName)) {
                    const actionFn = modelDefinition.actions[actionName];
                    // Bind the action function
                    actionsApi[actionName] = async (...args: any[]) => { // Use any[] for args here
                        const currentState = this.get(instance); // Get current state before action
                        try {
                            // Call the original action function with state and the rest of the arguments
                            const result = await actionFn(currentState, ...args);
                            // If action returns a new state, update the atom
                            // Check for undefined explicitly, allow null/false/0 as valid states
                            if (result !== undefined && result !== currentState) {
                                // Use internal set to bypass writability checks
                                // Use internal set AND explicitly propagate changes
                                this.internalSetState(instance, result);
                                // Ensure propagation happens after state update from action
                                this.propagateChanges(instance);
                            }
                            // Return the result, which could be a Promise or a direct value
                            return result;
                        } catch (error) {
                            console.error(`Error in action '${actionName}' for atom ${String(instance._id)}:`, error);
                            this.updateAtomState(instance, undefined, undefined, error); // Update state to error
                            throw error; // Re-throw error
                        }
                    };
                }
            }
            instance._actionsApi = actionsApi;
        }
        // Assert the return type using the AtomActions utility type
        return instance._actionsApi as AtomActions<TAtom>;
    }

    // --- Internal Methods ---

    private internalSetState<T>(instance: Atom<T>, newState: T): void {
        const oldValue = instance._value;
        if (oldValue !== newState) {
            instance._value = newState;
            instance._promise = undefined; // Clear async state on direct update
            instance._error = undefined;
            instance._state = 'valid'; // Ensure state is marked as valid
            this.notifySubscribers(instance);
            // propagateChanges is already called in the 'use' method after this now
            // this.propagateChanges(instance); // Avoid double propagation
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
        // Initialize state if not already set
        if (atom._state === undefined) {
            atom._state = 'idle';
        }
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
                _familyTemplateId: familyId, // Link instance back to its template
                // Reset instance-specific state
                _subscribers: undefined,
                _dependents: undefined,
                _dependencies: undefined,
                _value: undefined,
                _promise: undefined,
                _error: undefined,
                _streamController: undefined,
                _actionsApi: undefined,
                _state: 'idle', // Initialize state for new family instance
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
        instance._state = 'building'; // Set state before starting build
        this.currentlyBuilding.add(instance._id);
        this.buildStack.push(instance);

        // Clear previous dependencies before rebuilding
        // console.log(`[buildAtom ${String(instance._id)}] Clearing dependencies`);
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

            if (typeof init === 'object' && init !== null && 'build' in init && 'actions' in init) { // Model check
                buildFn = init.build as Function;
                isModel = true;
            } else if (typeof init === 'object' && init !== null && 'get' in init && 'set' in init) { // Writable Computed check
                 buildFn = init.get as Function; // Use the 'get' function from the definition
                 isModel = false; // It's not a model
            } else if (typeof init === 'function') { // Read-only computed or other function-based
                buildFn = init;
            }

            if (buildFn) {
                // Internal getter for build functions: throws errors/promises
                const getter: Getter = <D>(dep: Atom<D>): D => { // Explicitly type as Getter
                    const depInstance = this.resolveAtomInstance(dep);
                    // Dependency Tracking
                    // console.log(`[getter for ${String(instance._id)}] Registering dependency on ${String(depInstance._id)}`);
                    this.registerDependency(instance, depInstance);

                    // Check if dependency needs building/rebuilding
                    if (depInstance._state === 'idle' || depInstance._state === 'dirty') {
                        this.buildAtom(depInstance);
                    }

                    // Check for circular dependency *after* attempting to build dependency
                    // If the dependency is still being built, it means we hit a cycle.
                    if (this.currentlyBuilding.has(depInstance._id)) {
                        const path = [...this.buildStack.map(a => String(a._id)), String(depInstance._id)].join(' -> ');
                        throw new Error(`Circular dependency detected: ${path}`);
                    }

                    // Now check the state of the dependency *after* the build attempt
                    if (depInstance._error !== undefined) {
                        throw depInstance._error;
                    }
                    // Throw promise for Suspense-like behavior within build
                    if (depInstance._promise !== undefined) {
                         throw depInstance._promise;
                    }
                    // Return value if valid
                    if (depInstance._state === 'valid' && depInstance._value !== undefined) {
                         return depInstance._value as D;
                    }
                     // Handle static atoms if still idle (should become valid after this)
                    if (depInstance._state === 'idle' && typeof depInstance._init !== 'function') {
                         depInstance._value = depInstance._init as D;
                         depInstance._state = 'valid';
                         return depInstance._value as D;
                    }
                    // If state is not valid after potential build, something went wrong
                    throw new Error(`Dependency atom ${String(depInstance._id)} could not be resolved to a valid state.`);
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
                     // Pass the internal getter, which might return an error
                     result = buildFn(getter); // No cast needed now
                } else {
                     // Assume it expects the full context (e.g., context => ..., () => ..., async () => ...)
                     result = buildFn(context);
                }

                // Type checks must be ordered carefully
                if (result instanceof Promise) {
                    newPromise = result;
                    instance._promise = newPromise; // Set promise immediately
                    instance._state = 'pending'; // Mark as pending while promise resolves
                    // Ensure promise state is cleared *before* updating state
                    newPromise
                        .then(value => {
                            // Only update if the promise is still the current one
                            if (instance._promise === newPromise) {
                                // Clear promise *before* update to prevent race conditions if accessed during notify
                                instance._promise = undefined;
                                this.updateAtomState(instance, value, undefined, undefined);
                            }
                        })
                        .catch(error => {
                            if (instance._promise === newPromise) {
                                // Clear promise *before* update
                                instance._promise = undefined;
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
                    instance._state = 'pending'; // Mark as pending while stream emits

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
                            // Ensure state is updated even if aborted, but log differently?
                            // For now, update state regardless of abort signal if an error occurs during iteration.
                            console.error(`Error in AsyncIterable for atom ${String(instance._id)}:`, error);
                            // Clear promise *before* update
                            instance._promise = undefined; // Clear any pending promise state
                            this.updateAtomState(instance, undefined, undefined, error);
                            instance._streamController = undefined; // Clear controller on error
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
                    instance._state = 'pending'; // Mark as pending while observable emits

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
                     instance._state = 'pending'; // Mark as pending while thenable resolves
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
                 // Update state directly for sync results
                 this.updateAtomState(instance, newValue, undefined, undefined); // Sets state to 'valid'
            }

        } catch (error) {
            newError = error;
            // Update state to 'error'
            this.updateAtomState(instance, undefined, undefined, newError); // Sets state to 'error'
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

        // Determine the new state based on the outcome
        let newState: AtomState = 'idle'; // Default, should be overwritten
        if (error !== undefined) {
            newState = 'error';
        } else if (promise !== undefined) {
            newState = 'pending'; // Still pending if a promise is involved (though updateAtomState is called on resolution/rejection)
        } else if (value !== undefined) {
            newState = 'valid';
        }
        // TODO: Handle stream completion state?

        const stateChanged = instance._state !== newState;

        instance._value = value;
        instance._promise = promise;
        instance._error = error;
        instance._state = newState; // Set the new state

        if (valueChanged || promiseChanged || errorChanged || stateChanged) { // Include state change in notification check
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
         instance._state = 'dirty'; // Set state to dirty
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
        // console.log(`Clearing dependencies for ${String(atom._id)}`);
        atom._dependencies?.forEach((dep: Atom<any>) => {
            // console.log(`  Removing ${String(atom._id)} from dependents of ${String(dep._id)}`);
            dep._dependents?.delete(atom);
            // Optional: Clean up dependents set if empty? Maybe not necessary here.
        });
        atom._dependencies = new Set(); // Reset to a new empty Set instead of undefined
    }

    private maybeTeardownAtom(instance: Atom<any>) {
         // If atom has no subscribers and no dependents, potentially clean it up
         const noSubscribers = !instance._subscribers || instance._subscribers.size === 0;
         const noDependents = !instance._dependents || instance._dependents.size === 0;

         if (noSubscribers && noDependents) {
              const instanceId = instance._id;
              console.log(`Tearing down atom ${String(instanceId)}`);

              // 1. Cancel ongoing streams/async operations
              instance._streamController?.abort();
              instance._streamController = undefined;
              // TODO: Cancel promises? More complex.

              // 2. Clean up dependency links
              this.clearDependencies(instance);

              // 3. Remove from global atom cache
              this.atomCache.delete(instanceId);

              // 4. Remove from family cache if applicable
              if (instance._familyTemplateId && instance._lastParam !== undefined) {
                  const familyId = instance._familyTemplateId;
                  const paramKey = JSON.stringify(instance._lastParam);
                  const familyInstances = this.familyCache.get(familyId);
                  if (familyInstances) {
                      familyInstances.delete(paramKey);
                      console.log(`Removed instance ${String(instanceId)} (param: ${paramKey}) from family ${String(familyId)} cache.`);
                      // If the family map is now empty, remove the family entry itself
                      if (familyInstances.size === 0) {
                          this.familyCache.delete(familyId);
                          console.log(`Removed empty family cache for ${String(familyId)}.`);
                      }
                  }
              }
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
            // Invalidate dependent - it will rebuild lazily on next access
            this.invalidateAtom(dependent);
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
