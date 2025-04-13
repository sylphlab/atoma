import { Atom, AtomInitializer, AtomFamilyTemplate, isFamilyAtomTemplate } from './types.js';
import { getDefaultStore } from './store.js';

/**
 * Creates a new atom, the core state unit.
 *
 * Can create:
 * - Simple static atoms: `atom(value)`
 * - Computed atoms: `atom(get => ...)`
 * - Async atoms: `atom(async get => ...)`
 * - Stream atoms: `atom(() => Observable)`
 * - Model-like atoms: `atom({ build: ..., actions: ... })`
 * - Family atoms: Use `atomFamily((param) => ...)`
 */
export function atom<T>(
    initializer: AtomInitializer<T>
): Atom<T> {

    const id = Symbol('atom');

    // Create the Atom object directly with readonly properties
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
    };
    return newAtom;
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
