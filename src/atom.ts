import {
    Atom, AtomInitializer, FunctionAtomInitializer, FamilyInitializerFunction, // Corrected import name
    AtomModelDefinition, WritableComputedAtomDefinition, Getter, AtomContext,
    FamilyInvoker, FamilyMemberAtomDescriptor // Use Descriptor type
} from './types.js';
// getDefaultStore import removed as it's not used in this file anymore
// --- Atom Function Overloads ---

// --- Atom Function Overloads ---
// Order is important for correct type inference

// Order is crucial for correct type inference. More specific signatures first.

// 1. Model-like atoms (non-family) - Most specific object structure
export function atom<TState, TActions extends Record<string, (state: TState, ...args: any[]) => any>>(
    initializer: AtomModelDefinition<TState, TActions>
): Atom<TState> & { _init: AtomModelDefinition<TState, TActions> };

// 2. Writable computed atoms (non-family) - Specific object structure
export function atom<T>(
    initializer: WritableComputedAtomDefinition<T>
): Atom<T> & { _init: WritableComputedAtomDefinition<T> };

// 3. Read-only computed atoms (getter function - non-family, length 1) - Specific function signature
export function atom<T>(
    initializer: (get: Getter) => T
): Atom<T> & { _init: (get: Getter) => T };

// 4. Read-only computed atoms (context function - non-family, length 1) - Specific function signature
export function atom<T>(
    initializer: (context: AtomContext) => T | Promise<T> | AsyncIterable<T> /* | Observable<T> */
): Atom<T> & { _init: (context: AtomContext) => T | Promise<T> | AsyncIterable<T> };

// 5. Family Atom Template (function with context + AT LEAST one parameter) - Function with length > 1
export function atom<T, P extends [any, ...any[]]>( // Enforce P has at least one element
    initializer: FamilyInitializerFunction<T, P>
): FamilyInvoker<T, P>;

// 6. Simple static value atoms (must come last)
export function atom<T>(
    initializer: T extends Function ? never : T // Prevent functions matching this overload if possible
): Atom<T> & { _init: T };

// --- Atom Function Implementation ---
/**
 * Creates a new atom, the core state unit.
 */
// Implementation
export function atom(initializer: any): any { // Return type 'any' for simplicity in implementation
    const id = Symbol('atom');

    // Runtime check based on function arity to distinguish family template
    if (typeof initializer === 'function' && initializer.length > 1) {
        // It's a family initializer function. Return the invoker.
        const familyInitializerFn = initializer as FamilyInitializerFunction<any, [any, ...any[]]>;
        const templateId = id; // Use the generated ID for the template concept

        const invoker: FamilyInvoker<any, any[]> = (...params: any[]) => {
            // Descriptor now includes the initializer function itself
            const descriptor: FamilyMemberAtomDescriptor<any, any[]> = {
                _templateAtomId: templateId,
                _params: params,
                _init: familyInitializerFn, // Pass the initializer
                _isFamilyMemberDescriptor: true,
            };
            return descriptor;
        };
        (invoker as any)._templateId = templateId; // Keep for debugging
        return invoker;
    }

    // Determine _initType hint for non-family atoms
    let initType: 'static' | 'getter' | 'context' | 'model' | 'writable' = 'static';
    if (typeof initializer === 'function') {
        // Crude check based on function signature (less reliable than overloads)
        // This hint helps buildAtom decide how to call the function.
        const funcStr = initializer.toString();
        if (initializer.length === 1 && (funcStr.includes('get(') || funcStr.match(/\(\s*\{?\s*get\s*\}?\s*\)/))) {
             initType = 'getter';
        } else if (initializer.length === 1) {
             initType = 'context'; // Default for length 1 function
        } else if (initializer.length === 0) {
             initType = 'context'; // Assume context for 0-arg functions (like model build)
        }
        // Note: Family functions (length > 1) are handled above.
    } else if (typeof initializer === 'object' && initializer !== null) {
        if ('actions' in initializer && 'build' in initializer) {
            initType = 'model';
        } else if ('get' in initializer && 'set' in initializer) {
            initType = 'writable';
        }
    }


    const newAtom: Atom<any> & { _initType?: typeof initType } = {
        _id: id,
        _init: initializer,
        _initType: initType, // Store hint for buildAtom
        // Initialize internal state properties
        _subscribers: undefined,
        _dependents: undefined,
        _dependencies: undefined,
        _value: undefined,
        _promise: undefined,
        _error: undefined,
        _streamController: undefined,
        _actionsApi: undefined,
        _lastParam: undefined, // Not used for non-family atoms
        _state: 'idle',
    };
    return newAtom;
}
