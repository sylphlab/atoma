/**
 * Represents a function to get the value of another atom within a computed atom or model build.
 */
export type Getter = <T>(atom: Atom<T>) => T;

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


export type AtomInitializer<T> =
  | T
  // Read-only computed
  | ((get: Getter) => T)
  // Async/Stream/Complex Sync computed (read-only by default)
  | ((context: AtomContext) => T | Promise<T> | AsyncIterable<T> /* | Observable<T> */)
  // Model-like
  | AtomModelDefinition<T, any>
  // Writable computed
  | WritableComputedAtomDefinition<T>;

/**
 * Represents the definition for a model-like atom with state and actions.
 */
export interface AtomModelDefinition<TState, TActions extends Record<string, (...args: any[]) => any>> {
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
  // _isFamily flag removed, handled by distinct types now
  // Internal properties for store management
  _subscribers?: Set<(value?: T, error?: unknown) => void>; // Matches Store.on signature
  _dependents?: Set<Atom<any>>; // Atoms that depend on this one
  _dependencies?: Set<Atom<any>>; // Atoms this one depends on
  _value?: T; // Cached value
  _promise?: Promise<T>; // Pending promise for async atoms
  _error?: unknown; // Error from async atom
  _streamController?: AbortController; // Controller for streams/async iterables
  _actionsApi?: any; // Cached actions API for model-like atoms
  _lastParam?: any; // Last parameter used for family instance (if applicable)
  _familyTemplateId?: symbol; // ID of the family template this instance belongs to (if applicable)
  _state?: AtomState; // Current state of the atom instance
}

/**
 * Represents a template for creating parameterized atoms (a family).
 * It's not an Atom instance itself, but a factory.
 */
export interface AtomFamilyTemplate<T = unknown, P = any> {
  readonly _id: symbol; // Unique identifier for the family template
  // The initializer function that takes a parameter and returns an AtomInitializer
  readonly _init: (param: P) => AtomInitializer<T>;
  // Add a distinct property to help type guards, though structure differs now
  readonly _isFamilyTemplate: true; // Distinct property for type guards
}

/**
 * Type guard to check if an object is an AtomFamilyTemplate.
 */
export function isFamilyAtomTemplate<T, P>(
  template: unknown // Check against unknown as it might not be an Atom
): template is AtomFamilyTemplate<T, P> {
  // Check for the distinct property and the initializer function type
  return typeof template === 'object' && template !== null && (template as any)._isFamilyTemplate === true && typeof (template as any)._init === 'function';
}

/**
 * Represents the actions extracted from a model-like atom.
 */
export type AtomActions<TAtom extends Atom<any>> =
  TAtom['_init'] extends AtomModelDefinition<any, infer TActions>
    ? { [K in keyof TActions]: (...args: Parameters<TActions[K]>[1]) => ReturnType<TActions[K]> }
    : never;
