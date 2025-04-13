/**
 * Represents a function to get the value of another atom within a computed atom or model build.
 */
export type Getter = <T>(atomOrDescriptor: Atom<T> | FamilyMemberAtomDescriptor<T>) => T; // Accept Atom or Descriptor

/**
 * Represents the context passed to async/computed atom initializers.
 */
export interface AtomContext {
  get: Getter;
  watch: <T>(atom: Atom<T>, callback: (value?: T, error?: unknown) => void) => () => void; // Subscribes to another atom, matches Store.on signature
  invalidate: () => void; // Invalidates the current atom's value
  // TODO: Add signal for abortion (e.g., AbortSignal)
  // TODO: Add keepalive mechanism?
}

/**
 * Represents the initializer function for an atom.
 * Can be a static value, a function returning a value (computed), 
 * an async function, a function returning a stream (Observable), 
 * or a model definition.
 */
/**
 * Represents the setter function for a writable computed atom.
 */
export type Setter = <T>(atom: Atom<T>, value: T | ((prev: T) => T)) => void;

/**
 * Represents the definition for a writable computed atom.
 */
export interface WritableComputedAtomDefinition<T> {
  get: ((get: Getter) => T) | ((context: AtomContext) => T | Promise<T> | AsyncIterable<T>);
  set: (context: { get: Getter; set: Setter }, newValue: T) => void; // Context includes get and set
}


// Base type for initializers that are functions (excluding static values)
export type FunctionAtomInitializer<T> =
    // Read-only computed (getter only)
    | ((get: Getter) => T)
    // Async/Stream/Complex Sync computed (context only)
    | ((context: AtomContext) => T | Promise<T> | AsyncIterable<T> /* | Observable<T> */)
    // Model-like (build function can take get or context)
    | AtomModelDefinition<T, any>
    // Writable computed (get function can take get or context)
    | WritableComputedAtomDefinition<T>;

// Initializer function signature specifically for families.
// It MUST take context as the first argument, followed by parameters,
// and it MUST return another AtomInitializer (not the final value directly).
// Enforce at least one parameter after context for families
export type FamilyInitializerFunction<T, P extends [any, ...any[]]> =
    (context: AtomContext, ...params: P) => AtomInitializer<T>;

// Combined type for any atom initializer
export type AtomInitializer<T> =
    | T // Static value
    | FunctionAtomInitializer<T>; // Function-based (non-family)
    // Note: Family initializers (FamilyInitializerFunction) are handled by a separate overload in atom()
    // and are not part of the AtomInitializer union to prevent ambiguity with context-only functions.

/**
 * Represents the definition for a model-like atom with state and actions.
 */
export interface AtomModelDefinition<TState, TActions extends Record<string, (...args: any[]) => any>> {
  // Build function for models CANNOT accept additional parameters (must be 0 or 1 arg)
  build: (() => TState) | ((get: Getter) => TState) | ((context: AtomContext) => TState | Promise<TState> | AsyncIterable<TState>);
  actions: TActions;
}

/**
 * Represents the core state unit.
 */
export type AtomState = 'idle' | 'building' | 'valid' | 'error' | 'pending' | 'dirty';

export interface Atom<T = unknown> {
  readonly _id: symbol; // Unique identifier
  readonly _init: AtomInitializer<T>;
  // _templateAtomId and _paramKey removed from public Atom interface.
  // They exist only on the internal instances managed by the store.
  // Internal properties for store management
  _subscribers?: Set<(value?: T, error?: unknown) => void>; // Matches Store.on signature
  _dependents?: Set<Atom<any>>; // Atoms that depend on this one
  _dependencies?: Set<Atom<any>>; // Atoms this one depends on
  _value?: T; // Cached value
  _promise?: Promise<T>; // Pending promise for async atoms
  _error?: unknown; // Error from async atom
  _streamController?: AbortController; // Controller for streams/async iterables
  _actionsApi?: any; // Cached actions API for model-like atoms
  _lastParam?: any; // Actual parameter value used to create this instance (for internal use)
  _state?: AtomState; // Current state of the atom instance
}

// Represents the function returned by atom() when the initializer is for a family.
// This function takes the parameter and returns a FamilyMemberAtom descriptor.
export type FamilyInvoker<T, P extends any[]> = (...params: P) => FamilyMemberAtomDescriptor<T, P>;

// Represents the descriptor object returned by a FamilyInvoker.
export interface FamilyMemberAtomDescriptor<T = unknown, P extends any[] = any[]> {
  readonly _templateAtomId: symbol; // ID of the *template* atom
  readonly _params: P; // The specific parameters for this member
  readonly _init: FamilyInitializerFunction<T, P extends [any, ...any[]] ? P : [any, ...any[]]>; // Match constraint
  readonly _isFamilyMemberDescriptor: true; // Type guard property
  // Add phantom type to satisfy Atom<T> usage in some places if needed, or adjust store methods
  // readonly _phantomValue?: T;
}

/** Type guard for FamilyMemberAtom descriptors */
export function isFamilyMemberDescriptor<T, P extends any[]>(
  value: unknown
): value is FamilyMemberAtomDescriptor<T, P> {
  return typeof value === 'object' && value !== null && (value as any)._isFamilyMemberDescriptor === true;
}

// Adjust Atom interface slightly - _templateAtomId/_paramKey/_lastParam are only on *internal* instances, not descriptors.
// Remove them from the public Atom interface.
/**
 * Represents the actions extracted from a model-like atom.
 */
// Utility type to get all parameters except the first one
export type RestParameters<T extends (...args: any) => any> =
  T extends (first: any, ...rest: infer R) => any ? R : never;

// Simpler AtomActions definition - might lose some specific type safety but aims to avoid 'never'
export type AtomActions<TAtom extends Atom<any>> =
  TAtom['_init'] extends AtomModelDefinition<any, infer TActions>
    ? TActions // Directly return the inferred actions type
    : never;
