import {
    Atom, AtomInitializer, AtomFamilyTemplate, isFamilyAtomTemplate,
    AtomModelDefinition, WritableComputedAtomDefinition, Getter, AtomContext
} from './types.js';
import { getDefaultStore } from './store.js';

// --- Atom Function Overloads ---

// Overload 1: Model-like atoms
export function atom<TState, TActions extends Record<string, (state: TState, ...args: any[]) => any>>(
    initializer: AtomModelDefinition<TState, TActions>
): Atom<TState> & { _init: AtomModelDefinition<TState, TActions> }; // Return more specific type

// Overload 2: Writable computed atoms
export function atom<T>(
    initializer: WritableComputedAtomDefinition<T>
): Atom<T> & { _init: WritableComputedAtomDefinition<T> }; // Return more specific type

// Overload 3: Read-only computed atoms (getter function)
export function atom<T>(
    initializer: (get: Getter) => T
): Atom<T> & { _init: (get: Getter) => T }; // Return specific function type

// Overload 4: Read-only computed atoms (context function - sync/async/stream)
export function atom<T>(
    initializer: (context: AtomContext) => T | Promise<T> | AsyncIterable<T> /* | Observable<T> */
): Atom<T> & { _init: (context: AtomContext) => T | Promise<T> | AsyncIterable<T> }; // Return specific function type

// Overload 5: Simple static value atoms (must come after functions to avoid ambiguity)
export function atom<T>(
    initializer: T extends Function ? never : T // Prevent functions matching this overload
): Atom<T> & { _init: T }; // Return specific value type

// --- Atom Function Implementation ---
/**
 * Creates a new atom, the core state unit.
 */
export function atom<T>(
    initializer: AtomInitializer<T>
): Atom<T> { // Implementation signature remains general

    const id = Symbol('atom');

    // Create the Atom object directly with readonly properties
    // We cast the return type to Atom<T> as the implementation covers all cases,
    // but specific overload signatures provide better type inference for callers.
    const newAtom: Atom<T> = {
        _id: id,
        _init: initializer,
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
        _state: 'idle', // Initialize state
    };
    return newAtom; // Return the general type, overloads handle external typing
}

/**
 * Creates a new atom family template.
 *
 * Example: `atomFamily((id: string) => atom(async () => fetchUser(id)))`
 */
export function atomFamily<T, P>(
    initializer: (param: P) => AtomInitializer<T>
): AtomFamilyTemplate<T, P> {
    const id = Symbol('family');

    const familyTemplate: AtomFamilyTemplate<T, P> = {
        _id: id,
        _init: initializer,
        _isFamilyTemplate: true,
    };

    // Note: Family templates don't hold state like individual atoms.
    // The store manages instances derived from the template.

    return familyTemplate;
}
