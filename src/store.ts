import {
    Atom, Getter, AtomContext, AtomInitializer, AtomModelDefinition, AtomActions,
    WritableComputedAtomDefinition, Setter, AtomState, FamilyMemberAtomDescriptor,
    isFamilyMemberDescriptor, FamilyInitializerFunction // Added necessary types
} from './types.js';

// Symbol for internal store reference in actions
const STORE_REF = Symbol('storeRef');

// Internal interface extending Atom to include family instance properties
interface InternalAtom<T = unknown> extends Atom<T> {
    _templateAtomId?: symbol;
    _paramKey?: string;
    // _lastParam is already in Atom<T>
}


/**
 * Manages the state of atoms and their dependencies.
 */
export class Store {
    // Use InternalAtom for caches to allow storing family properties
    private atomCache = new Map<symbol, InternalAtom<any>>(); // Cache for ALL atom instances (including family instances)
    private familyCache = new Map<symbol, Map<string, InternalAtom<any>>>(); // Cache for family instances { templateAtomId -> { paramKey -> instanceAtom } }
    private currentlyBuilding = new Set<symbol>(); // Track atoms currently being built to detect circular dependencies
    private buildStack: InternalAtom<any>[] = []; // Track the stack of atoms being built for dependency tracking

    /**
     * Retrieves the current value of an atom instance.
     * Accepts either a regular Atom or a FamilyMemberAtomDescriptor.
     */
    // Relax T constraint here, internal logic handles async/stream
    get<T>(atomOrDescriptor: Atom<T> | FamilyMemberAtomDescriptor<T>): T {
        const instance = this.resolveAtomInstance(atomOrDescriptor);

        // Dependency Tracking
        if (this.buildStack.length > 0) {
            const dependent = this.buildStack[this.buildStack.length - 1];
            this.registerDependency(dependent, instance);
        }

        // Build if needed
        if (instance._state === 'idle' || instance._state === 'dirty') {
            this.buildAtom(instance);
        }

        // Handle state
        if (instance._error !== undefined) throw instance._error;
        if (instance._state === 'valid' && instance._value !== undefined) return instance._value as T;
        if (instance._state === 'pending' && instance._promise !== undefined) throw instance._promise;
        if (instance._value !== undefined) return instance._value as T; // Fallback for valid state without promise/error

        // Handle static atoms if still idle after potential build call
        if (instance._state === 'idle' && typeof instance._init !== 'function') {
             instance._value = instance._init as T;
             instance._state = 'valid';
             return instance._value as T;
        }

        throw new Error(`Atom ${String(instance._id)} could not be resolved.`);
    }

    /**
     * Sets the value of a writable atom instance.
     * Throws an error if the atom is read-only, has actions, or if a descriptor is passed.
     */
    // Relax T constraint here
    set<T>(atomOrDescriptor: Atom<T> | FamilyMemberAtomDescriptor<T>, value: T | ((prev: T) => T)): void {
        if (isFamilyMemberDescriptor(atomOrDescriptor)) {
            throw new Error(`Cannot 'set' a family member descriptor directly. Get the instance first via store.get(familyInvoker(param)) or use the instance returned by store.on().`);
        }
        // Now we know it's an Atom<T>
        const instance = this.resolveAtomInstance(atomOrDescriptor); // Resolve to get the internal instance
        const init = instance._init;

        // Disallow setting model-like atoms
        if (typeof init === 'object' && init !== null && 'actions' in init && 'build' in init) {
            throw new Error('Cannot set model-like atom directly. Use store.use(atom).actionName().');
        }

        // Handle writable computed atoms
        if (typeof init === 'object' && init !== null && 'get' in init && 'set' in init) {
            const writableDef = init as WritableComputedAtomDefinition<T>;
            const setterContext = {
                get: <D>(dep: Atom<D> | FamilyMemberAtomDescriptor<D>) => this.get(dep), // Pass descriptor support
                set: <D>(dep: Atom<D> | FamilyMemberAtomDescriptor<D>, val: D | ((prev: D) => D)) => this.set(dep, val) // Pass descriptor support
            };
            const newValueToSet = typeof value === 'function'
                ? (value as (prev: T) => T)(this.get(instance)) // Pass current value
                : value;
            writableDef.set(setterContext, newValueToSet);
            return;
        }

        // Disallow setting read-only computed atoms or family templates
        if (typeof init === 'function') {
             // Check if it's a family template atom itself (has no _templateAtomId)
             if (init.length > 1 && (instance as InternalAtom<T>)._templateAtomId === undefined) {
                 throw new Error(`Cannot set a family template atom [${String(instance._id)}] directly.`);
             }
             // Otherwise, it's a read-only computed atom (regular or family member instance)
             throw new Error(`Cannot set read-only computed atom [${String(instance._id)}].`);
        }

        // Must be a simple static atom instance
        const oldValue = instance._value;
        const newValue = typeof value === 'function'
            ? (value as (prev: T) => T)(oldValue as T)
            : value;

        if (oldValue !== newValue) {
            instance._value = newValue;
            instance._promise = undefined;
            instance._error = undefined;
            instance._state = 'valid';
            this.notifySubscribers(instance);
            this.propagateChanges(instance);
        }
    }

    /**
     * Subscribes to changes in an atom's value.
     * Accepts either a regular Atom or a FamilyMemberAtomDescriptor.
     */
    // Relax T constraint here
    on<T>(atomOrDescriptor: Atom<T> | FamilyMemberAtomDescriptor<T>, callback: (value?: T, error?: unknown) => void): () => void {
        const instance = this.resolveAtomInstance(atomOrDescriptor); // Resolve to get the internal instance
        if (!instance._subscribers) {
            // Use type assertion for the Set to match the internal Atom<T> type
            instance._subscribers = new Set<(value?: T, error?: unknown) => void>();
        }
        // Use type assertion for the callback to match the Set's expected type
        instance._subscribers.add(callback as (value?: T, error?: unknown) => void);

        // Trigger initial build or notify immediately
        if (instance._state === 'idle') {
             this.buildAtom(instance);
        } else if (instance._state === 'valid' || instance._state === 'error') {
             try { callback(instance._value, instance._error); } catch (err) { console.error("Error in initial subscriber notification:", err); }
        }

        return () => {
            const subscribers = instance._subscribers;
            if (subscribers) {
                // Use type assertion for the callback
                subscribers.delete(callback as (value?: T, error?: unknown) => void);
                if (subscribers.size === 0) {
                    this.maybeTeardownAtom(instance);
                }
            }
        };
    }

    /**
     * Retrieves the actions API for a model-like atom instance.
     * Throws an error if a descriptor is passed.
     */
    // Relax constraint on descriptor T type
    use<TAtom extends Atom<any>>(atomOrDescriptor: TAtom | FamilyMemberAtomDescriptor<any>): AtomActions<TAtom> {
         if (isFamilyMemberDescriptor(atomOrDescriptor)) {
            throw new Error(`Cannot 'use' a family member descriptor directly. Get the instance first via store.get(familyInvoker(param)) or use the instance returned by store.on().`);
        }
        // Now we know it's an Atom<TAtom>
        const instance = this.resolveAtomInstance(atomOrDescriptor); // Resolve to get the internal instance
        const definition = instance._init;

        // Check if it's a valid model definition
        if (typeof definition !== 'object' || definition === null || !('actions' in definition) || !('build' in definition) || typeof (definition as any).actions !== 'object' || (definition as any).actions === null) {
             // Check if it's accidentally a family template atom
             if (typeof definition === 'function' && definition.length > 1 && (instance as InternalAtom<any>)._templateAtomId === undefined) {
                 throw new Error(`Cannot call 'use' on a family template atom [${String(instance._id)}]. Use the invoker function atomTemplate(params) first.`);
             }
            throw new Error(`Atom [${String(instance._id)}] is not a valid model-like atom with actions.`);
        }

        const modelDefinition = definition as AtomModelDefinition<any, Record<string, (state: any, ...args: any[]) => any>>;

        // Cache the bound actions API
        if (!instance._actionsApi) {
            const actionsApi: any = {};
            for (const actionName in modelDefinition.actions) {
                if (Object.prototype.hasOwnProperty.call(modelDefinition.actions, actionName)) {
                    const actionFn = modelDefinition.actions[actionName];
                    actionsApi[actionName] = async (...args: any[]) => {
                        const currentState = this.get(instance);
                        try {
                            const result = await actionFn(currentState, ...args);
                            if (result !== undefined) {
                                this.internalSetState(instance, result);
                            }
                            return result;
                        } catch (error) {
                            console.error(`Error in action '${actionName}' for atom ${String(instance._id)}:`, error);
                            this.updateAtomState(instance, undefined, undefined, error);
                            throw error;
                        }
                    };
                }
            }
            instance._actionsApi = actionsApi;
        }
        // Cast needed as TAtom might be more specific than Atom<any>
        return instance._actionsApi as AtomActions<TAtom>;
    }

    // --- Internal Methods ---

    /** Creates or retrieves a cached instance for a family member descriptor */
    private createFamilyInstance<T, P extends any[]>(descriptor: FamilyMemberAtomDescriptor<T, P>): InternalAtom<T> {
        const templateId = descriptor._templateAtomId;
        const params = descriptor._params;
        const paramKey = JSON.stringify(params);

        // Get the initializer function directly from the descriptor
        const familyInitializer = descriptor._init as FamilyInitializerFunction<T, [any, ...any[]]>;
        if (typeof familyInitializer !== 'function' || familyInitializer.length <= 1) {
             throw new Error(`Internal Error: Invalid family initializer function found in descriptor for template ${String(templateId)}.`);
        }

        if (!this.familyCache.has(templateId)) {
            this.familyCache.set(templateId, new Map());
        }
        const instances = this.familyCache.get(templateId)!;

        if (!instances.has(paramKey)) {
            const instanceId = Symbol(`${String(templateId)}_${paramKey}`);

            // Create temporary context for the initializer function call
            // This context should NOT be used for dependency tracking of the final instance
            const tempGetter: Getter = <D>(dep: Atom<D> | FamilyMemberAtomDescriptor<D>): D => {
                 console.warn(`[createFamilyInstance] Getting dependency ${String(isFamilyMemberDescriptor(dep) ? dep._templateAtomId : dep._id)} during family initialization is discouraged.`);
                 try { return this.get(dep); } catch { throw new Error('Cannot resolve dependencies during family initialization.'); }
            };
             const tempContext: AtomContext = {
                 get: tempGetter,
                 watch: <D>(dep: Atom<D> | FamilyMemberAtomDescriptor<D>, cb: (value?: D | undefined, error?: unknown) => void) => {
                      console.warn(`[createFamilyInstance] Watching dependency during family initialization is not supported.`);
                      return () => {};
                 },
                 invalidate: () => {
                      console.warn(`[createFamilyInstance] Calling invalidate during family initialization has no effect.`);
                 },
             };

            // Call the family initializer function with context and parameters to get the member's initializer
            // Cast params to the expected tuple type for the spread operator
            // Use double cast as suggested by TS error
            const memberInitializer = familyInitializer(tempContext, ...(params as unknown as [any, ...any[]]));

            const instance: InternalAtom<T> = {
                _init: memberInitializer, // Use the initializer returned by the family function
                _id: instanceId,
                // Internal properties linking to family
                _templateAtomId: templateId,
                _paramKey: paramKey,
                _lastParam: params.length === 1 ? params[0] : params, // Store actual params
                // Reset instance-specific state
                _subscribers: undefined,
                _dependents: undefined,
                _dependencies: undefined,
                _value: undefined,
                _promise: undefined,
                _error: undefined,
                _streamController: undefined,
                _actionsApi: undefined,
                _state: 'idle',
            };
            instances.set(paramKey, instance);
            this.atomCache.set(instanceId, instance); // Also add to global atom cache
        }

        return instances.get(paramKey)!;
    }

    private internalSetState<T>(instance: InternalAtom<T>, newState: T): void {
        const oldValue = instance._value;
        if (oldValue !== newState) {
            instance._value = newState;
            instance._promise = undefined;
            instance._error = undefined;
            instance._state = 'valid';
            this.notifySubscribers(instance);
            this.propagateChanges(instance); // Propagate after internal set
        }
    }

    /** Resolves an Atom or FamilyMemberAtomDescriptor to its actual instance */
    private resolveAtomInstance<T>(atomOrDescriptor: Atom<T> | FamilyMemberAtomDescriptor<T>): InternalAtom<T> {
        if (isFamilyMemberDescriptor<T, any[]>(atomOrDescriptor)) { // Provide second type argument
            // It's a descriptor, find or create the instance
            return this.createFamilyInstance(atomOrDescriptor);
        } else {
            // It's a regular atom, resolve it normally
            const atom = atomOrDescriptor as InternalAtom<T>; // Cast to internal type
            if (this.atomCache.has(atom._id)) {
                return this.atomCache.get(atom._id)!;
            }
            // If not cached, it's a new regular atom. Cache and return it.
            if (atom._state === undefined) {
                atom._state = 'idle';
            }
            // Check if it's accidentally a family template atom passed directly
             if (typeof atom._init === 'function' && atom._init.length > 1) {
                 // This atom looks like a family template. It should be used via its invoker.
                 // Throwing an error might be too strict if there are valid use cases,
                 // but warning helps catch incorrect usage.
                 console.warn(`Atom [${String(atom._id)}] looks like a family template but was passed directly to get/on/set/use. Use the invoker function atomTemplate(params) instead.`);
             }

            this.atomCache.set(atom._id, atom);
            return atom;
        }
    }

    private buildAtom<T>(instance: InternalAtom<T>): void {
        if (this.currentlyBuilding.has(instance._id)) {
            const path = [...this.buildStack.map(a => String(a._id)), String(instance._id)].join(' -> ');
            throw new Error(`Circular dependency detected: ${path}`);
        }
        instance._state = 'building';
        this.currentlyBuilding.add(instance._id);
        this.buildStack.push(instance);

        this.clearDependencies(instance);
        instance._promise = undefined;
        instance._error = undefined;

        let newValue: T | undefined;
        let newPromise: Promise<T> | undefined;
        let newError: unknown | undefined;

        try {
            const init = instance._init; // This is the member initializer for family instances
            let buildFn: Function | undefined;
            let isModel = false;

            if (typeof init === 'object' && init !== null && 'build' in init && 'actions' in init) {
                buildFn = init.build as Function;
                isModel = true;
            } else if (typeof init === 'object' && init !== null && 'get' in init && 'set' in init) {
                 // For writable computed, the function to execute is the 'get' part
                 buildFn = init.get as Function;
                 isModel = false; // Not a model
            } else if (typeof init === 'function') {
                 // This should be a non-family function initializer (length 0 or 1)
                 if (init.length > 1) {
                      // This case should ideally not be reached if resolveAtomInstance works correctly
                      throw new Error(`Internal Error: Attempting to build atom [${String(instance._id)}] with a family initializer function directly.`);
                 }
                 buildFn = init;
            }

            if (buildFn) {
                const getter: Getter = <D>(depOrDesc: Atom<D> | FamilyMemberAtomDescriptor<D>): D => {
                    const depInstance = this.resolveAtomInstance(depOrDesc); // Resolve dependency
                    this.registerDependency(instance, depInstance);

                    if (depInstance._state === 'idle' || depInstance._state === 'dirty') {
                        this.buildAtom(depInstance);
                    }
                    if (this.currentlyBuilding.has(depInstance._id)) {
                        const path = [...this.buildStack.map(a => String(a._id)), String(depInstance._id)].join(' -> ');
                        throw new Error(`Circular dependency detected: ${path}`);
                    }
                    if (depInstance._error !== undefined) throw depInstance._error;
                    if (depInstance._promise !== undefined) throw depInstance._promise;
                    if (depInstance._state === 'valid' && depInstance._value !== undefined) return depInstance._value as D;
                    if (depInstance._state === 'idle' && typeof depInstance._init !== 'function') {
                         depInstance._value = depInstance._init as D;
                         depInstance._state = 'valid';
                         return depInstance._value as D;
                    }
                    throw new Error(`Dependency atom ${String(depInstance._id)} could not be resolved.`);
                };
                const context: AtomContext = {
                    get: getter,
                    watch: <D>(depOrDesc: Atom<D> | FamilyMemberAtomDescriptor<D>, cb: (value?: D, error?: unknown) => void) => this.on(depOrDesc, cb),
                    invalidate: () => this.invalidateAtom(instance),
                };

                // Execute build function (should be 0 or 1 arg for non-family members)
                let result: T | Promise<T> | AsyncIterable<T>;
                // Check the intended signature based on the overload hint if available
                const initType = (instance as any)._initType;

                // Determine how to call the build function based on its likely signature
                if (initType === 'getter' || (typeof init === 'function' && init.length === 1 && init.toString().includes('get('))) { // Crude check for getter signature
                     // Try calling with getter first if it looks like a getter function
                     try {
                         result = buildFn(getter);
                     } catch (e) {
                         // If calling with getter fails, maybe it expected context?
                         // This is heuristic and might need refinement.
                         console.warn(`Calling build function for atom ${String(instance._id)} with 'get' failed, trying 'context'. Error:`, e);
                         result = buildFn(context);
                     }
                } else if (initType === 'context' || typeof init === 'function' && init.length === 1) {
                     // Assume context if length is 1 and not identified as getter
                     result = buildFn(context);
                } else if (typeof init === 'function' && init.length === 0) {
                     // Length 0 function (e.g., model build)
                     result = buildFn();
                }
                 else {
                     // Fallback or error for unexpected cases (e.g., static value handled earlier, model/writable handled by extracting build/get)
                     // This path might indicate an issue with how buildFn was determined or the atom definition.
                     // If buildFn exists here, it likely came from a model or writable computed atom.
                     // Let's assume context for these if length is 1, or no args if 0.
                     if (buildFn.length === 1) {
                         result = buildFn(context);
                     } else if (buildFn.length === 0) {
                         result = buildFn();
                     } else {
                         throw new Error(`Internal Error: Cannot determine how to call build function for atom ${String(instance._id)}.`);
                     }
                 }

                // Handle result (Promise, AsyncIterable, Observable, sync value)
                if (result instanceof Promise) {
                    newPromise = result;
                    instance._promise = newPromise;
                    instance._state = 'pending';
                    newPromise
                        .then(value => {
                            if (instance._promise === newPromise) {
                                instance._promise = undefined;
                                this.updateAtomState(instance, value, undefined, undefined);
                            }
                        })
                        .catch(error => {
                            if (this.atomCache.has(instance._id)) { // Check if torn down
                                instance._promise = undefined;
                                this.updateAtomState(instance, undefined, undefined, error);
                            }
                        });
                } else if (typeof result === 'object' && result !== null && typeof (result as any)[Symbol.asyncIterator] === 'function') {
                    instance._streamController?.abort();
                    const controller = new AbortController();
                    instance._streamController = controller;
                    instance._state = 'pending';
                    this.notifySubscribers(instance); // Notify pending

                    (async () => {
                        try {
                            for await (const value of result as AsyncIterable<T>) {
                                if (controller.signal.aborted) return;
                                this.updateAtomState(instance, value, undefined, undefined);
                            }
                            if (!controller.signal.aborted) instance._streamController = undefined;
                        } catch (error) {
                            if (!controller.signal.aborted) { // Avoid state update if aborted before error
                                this.updateAtomState(instance, undefined, undefined, error);
                                instance._streamController = undefined;
                            }
                        }
                    })();
                     controller.signal.addEventListener('abort', () => console.log(`Abort signal received for AsyncIterable on atom ${String(instance._id)}`));
                } else if (typeof result === 'object' && result !== null && typeof (result as any).subscribe === 'function') {
                    instance._streamController?.abort();
                    const controller = new AbortController();
                    instance._streamController = controller;
                    instance._state = 'pending';
                     this.notifySubscribers(instance); // Notify pending

                    const subscription = (result as any).subscribe({
                        next: (value: T) => !controller.signal.aborted && this.updateAtomState(instance, value, undefined, undefined),
                        error: (error: unknown) => {
                            if (!controller.signal.aborted) {
                                this.updateAtomState(instance, undefined, undefined, error);
                                instance._streamController = undefined;
                            }
                        },
                        complete: () => !controller.signal.aborted && (instance._streamController = undefined),
                    });
                    const cleanup = typeof subscription === 'function' ? subscription : (subscription?.unsubscribe ? () => subscription.unsubscribe() : () => {});
                    instance._streamController.signal.addEventListener('abort', cleanup);
                } else if (typeof (result as any)?.then === 'function') { // Handle other thenables
                     newPromise = Promise.resolve(result as Promise<T>);
                     instance._promise = newPromise;
                     instance._state = 'pending';
                     newPromise.then(value => {
                         if (instance._promise === newPromise) this.updateAtomState(instance, value, undefined, undefined);
                     }).catch(error => {
                          if (this.atomCache.has(instance._id) && instance._promise === newPromise) { // Check if torn down or stale
                              this.updateAtomState(instance, undefined, undefined, error);
                          }
                     });
                }
                 else { // Synchronous value
                    newValue = result as T;
                }
            } else if (!isModel) { // Static value atom
                newValue = init as T;
            } else { // Invalid model definition (no build function)
                 throw new Error(`Invalid model definition for atom ${String(instance._id)}`);
            }

            // Update state for synchronous results
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
    private updateAtomState<T>(instance: InternalAtom<T>, value: T | undefined, promise: Promise<T> | undefined, error: unknown | undefined) {
        const oldValue = instance._value;
        const oldError = instance._error;
        const oldState = instance._state;

        const valueChanged = value !== undefined && instance._value !== value;
        const errorChanged = instance._error !== error; // Check if error status changed (or cleared)

        let newState: AtomState = 'idle';
        if (error !== undefined) newState = 'error';
        else if (promise !== undefined) newState = 'pending'; // Should only happen transiently during build
        else if (value !== undefined) newState = 'valid';

        const stateChanged = instance._state !== newState;

        instance._value = value;
        instance._error = error;
        instance._state = newState;
        instance._promise = undefined; // Ensure promise is cleared when setting final state

        // Determine if notification/propagation is needed
        // Notify if value changed, error status changed, or state changed significantly (e.g., pending -> valid)
        const notify = valueChanged || errorChanged || stateChanged;

        if (notify) {
            this.notifySubscribers(instance);
            // Propagate only if value changed or error status changed
            if (valueChanged || errorChanged) {
                 this.propagateChanges(instance);
            }
        }
    }

    private invalidateAtom<T>(instance: InternalAtom<T>) {
         if (instance._state === 'dirty') return;
         instance._state = 'dirty';
         // Keep stale value for potential immediate return? Or clear? Let's clear for now.
         instance._value = undefined;
         instance._promise = undefined;
         instance._error = undefined;
         this.propagateInvalidation(instance);
    }

    private propagateInvalidation(invalidatedAtom: InternalAtom<any>) {
         invalidatedAtom._dependents?.forEach((dependent: InternalAtom<any>) => {
              this.invalidateAtom(dependent);
         });
    }

    private registerDependency(dependent: InternalAtom<any>, dependency: InternalAtom<any>) {
        if (!dependent._dependencies) dependent._dependencies = new Set();
        dependent._dependencies.add(dependency);

        if (!dependency._dependents) dependency._dependents = new Set();
        dependency._dependents.add(dependent);
    }

    private clearDependencies(atom: InternalAtom<any>) {
        atom._dependencies?.forEach((dep: InternalAtom<any>) => {
            dep._dependents?.delete(atom);
        });
        atom._dependencies = new Set();
    }

    private maybeTeardownAtom(instance: InternalAtom<any>) {
         const noSubscribers = !instance._subscribers || instance._subscribers.size === 0;
         const noDependents = !instance._dependents || instance._dependents.size === 0;

         if (noSubscribers && noDependents) {
              const instanceId = instance._id;
              console.log(`Tearing down atom ${String(instanceId)}`);

              instance._streamController?.abort();
              instance._streamController = undefined;
              this.clearDependencies(instance);
              this.atomCache.delete(instanceId);

              // Remove from family cache if applicable
              if (instance._templateAtomId && instance._paramKey !== undefined) {
                  const templateId = instance._templateAtomId;
                  const paramKey = instance._paramKey;
                  const familyInstances = this.familyCache.get(templateId);
                  if (familyInstances) {
                      familyInstances.delete(paramKey);
                      console.log(`Removed instance ${String(instanceId)} (paramKey: ${paramKey}) from family template ${String(templateId)} cache.`);
                      if (familyInstances.size === 0) {
                          this.familyCache.delete(templateId);
                          console.log(`Removed empty family cache for template ${String(templateId)}.`);
                      }
                  }
              }
         }
    }

    private notifySubscribers<T>(instance: InternalAtom<T>): void {
        // Use a temporary copy in case a subscriber modifies the set during iteration
        const subscribers = Array.from(instance._subscribers || []);
        // Use type assertion for the callback in forEach
        subscribers.forEach((callback: (value?: T, error?: unknown) => void) => {
            try {
                callback(instance._value, instance._error);
            } catch (err) {
                console.error("Error in subscriber:", err);
            }
        });
    }

    private propagateChanges(changedAtom: InternalAtom<any>): void {
        // Use a temporary copy in case invalidation modifies the set
        const dependents = Array.from(changedAtom._dependents || []);
        dependents.forEach((dependent: InternalAtom<any>) => {
            this.invalidateAtom(dependent);
        });
    }
}

// Default global store instance
let defaultStore: Store | null = null;

export function getDefaultStore(): Store {
    if (!defaultStore) {
        defaultStore = new Store();
    }
    return defaultStore;
}
