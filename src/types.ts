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
export type AtomInitializer<T> =
  | T
  // Note: Parameterized functions are now handled by AtomFamilyTemplate
  | ((get: Getter) => T)
  | ((context: AtomContext) => T | Promise<T> | AsyncIterable<T> /* | Observable<T> */)
  | AtomModelDefinition<T, any>;

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
  _lastParam?: any; // Last parameter used for family instance
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
