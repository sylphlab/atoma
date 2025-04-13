import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from './store';
import { atom } from './atom';

// Helper function to wait for promises to settle in tests
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    // Create a new store instance for each test to ensure isolation
    store = new Store();
  });

  it('should get initial value of a static atom', () => {
    const countAtom = atom(0);
    expect(store.get(countAtom)).toBe(0);
  });

  it('should set and get value of a static atom', () => {
    const countAtom = atom(0);
    store.set(countAtom, 5);
    expect(store.get(countAtom)).toBe(5);
  });

  it('should get initial value of a computed atom', () => {
    const countAtom = atom(5);
    const doubleAtom = atom(get => get(countAtom) * 2);
    expect(store.get(doubleAtom)).toBe(10);
  });

  it('should update computed atom when dependency changes', () => {
    const countAtom = atom(5);
    const doubleAtom = atom(get => get(countAtom) * 2);

    expect(store.get(doubleAtom)).toBe(10);
    store.set(countAtom, 10);
    expect(store.get(doubleAtom)).toBe(20);
  });

  it('should subscribe to atom changes', () => {
    const countAtom = atom(0);
    const listener = vi.fn();

    const unsubscribe = store.on(countAtom, listener);
    // Expect initial call upon subscription completion (buildAtom triggers notify)
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(0, undefined); // Initial value

    store.set(countAtom, 1);
    // Expect second call after setting the value
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(1, undefined); // value, error

    store.set(countAtom, 2);
    // Expect third call
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(2, undefined);

    unsubscribe();
    store.set(countAtom, 3);
    expect(listener).toHaveBeenCalledTimes(3); // Should not be called after unsubscribe
  });

  it('should handle basic async atoms', async () => {
    const asyncAtom = atom(async () => {
      await tick(); // Simulate async work
      return 'async value';
    });

    // Initial get might throw promise for Suspense
    let value: string | undefined;
    let error: unknown | undefined;
    try {
      store.get(asyncAtom);
    } catch (e) {
      if (e instanceof Promise) {
        await e; // Wait for the promise thrown by get
        await tick(); // Add extra tick to allow microtasks (.then handler) to run
      } else {
        error = e;
      }
    }
    expect(error).toBeUndefined();
    // Assert the type as string, as we expect the promise to be resolved after the awaits
    value = store.get(asyncAtom) as unknown as string;
    expect(value).toBe('async value');
  });

  it('should notify subscribers of async atom resolution', async () => {
    const asyncAtom = atom(async () => {
      await tick();
      return 'resolved';
    });
    const listener = vi.fn();

    store.on(asyncAtom, listener);

    // Listener might be called initially with undefined/pending state depending on implementation
    // Wait for resolution
    await tick(); // Allow buildAtom promise to resolve
    await tick(); // Allow microtask queue to clear for notification

    expect(listener).toHaveBeenCalled();
    // Check the last call for the resolved value
    const lastCallArgs = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCallArgs[0]).toBe('resolved');
    expect(lastCallArgs[1]).toBeUndefined(); // No error
  });

  it('should handle async atom errors', async () => {
    const errorAtom = atom(async () => {
      await tick();
      throw new Error('Async failed');
    });
    const listener = vi.fn();

    store.on(errorAtom, listener);

    let caughtError: unknown;
    try {
      store.get(errorAtom);
    } catch (e) {
      if (e instanceof Promise) {
        try {
          await e;
        } catch (innerError) {
          caughtError = innerError;
        }
      } else {
        caughtError = e;
      }
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('Async failed');

    // Check listener was called with error
    await tick(); // Allow microtask queue
    expect(listener).toHaveBeenCalled();
    const lastCallArgs = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCallArgs[0]).toBeUndefined(); // No value
    expect(lastCallArgs[1]).toBeInstanceOf(Error);
    expect((lastCallArgs[1] as Error).message).toBe('Async failed');

    // Subsequent gets should also throw the error
    expect(() => store.get(errorAtom)).toThrow('Async failed');
  });

  it('should handle writable computed atoms', () => {
    const sourceAtom = atom(10);
    const writableComputed = atom<number>({
      get: (get) => get(sourceAtom) * 2,
      set: ({ set }, newValue) => {
        // Assume setting the computed atom updates the source atom divided by 2
        set(sourceAtom, newValue / 2);
      }
    });

    // Initial get
    expect(store.get(writableComputed)).toBe(20);

    // Set the computed atom
    store.set(writableComputed, 50);

    // Check if computed atom reflects the change (it should recompute based on source)
    expect(store.get(writableComputed)).toBe(50); // Setter should have updated source to 25, getter computes 25*2=50

    // Check if the source atom was updated by the setter
    expect(store.get(sourceAtom)).toBe(25);

    // Check subscription on computed
    const listener = vi.fn();
    const unsubscribe = store.on(writableComputed, listener);
    expect(listener).toHaveBeenCalledTimes(1); // Initial value
    expect(listener).toHaveBeenCalledWith(50, undefined);

    // Update source directly
    store.set(sourceAtom, 30);
    expect(store.get(writableComputed)).toBe(60);
    expect(listener).toHaveBeenCalledTimes(2); // Notification due to dependency change
    expect(listener).toHaveBeenLastCalledWith(60, undefined);

    unsubscribe();
  });

  it('should manage atom state transitions correctly', () => {
    const staticAtom = atom(1);
    const computedAtom = atom(get => get(staticAtom) + 1);
    const storeInternal = store as any;

    // Initial state should be 'idle' before first get
    expect(storeInternal.atomCache.get(staticAtom._id)?._state).toBeUndefined(); // Not in cache yet
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBeUndefined();

    // Get static atom
    store.get(staticAtom);
    expect(storeInternal.atomCache.get(staticAtom._id)?._state).toBe('valid');

    // Get computed atom (triggers build)
    store.get(computedAtom);
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBe('valid');
    expect(storeInternal.atomCache.get(staticAtom._id)?._state).toBe('valid'); // Dependency should also be valid

    // Invalidate computed atom
    storeInternal.invalidateAtom(computedAtom);
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBe('dirty');
    expect(storeInternal.atomCache.get(staticAtom._id)?._state).toBe('valid'); // Dependency state shouldn't change yet

    // Get computed atom again (triggers rebuild)
    expect(store.get(computedAtom)).toBe(2);
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBe('valid');

    // Invalidate static atom (should invalidate dependent computed atom)
    storeInternal.invalidateAtom(staticAtom);
    expect(storeInternal.atomCache.get(staticAtom._id)?._state).toBe('dirty');
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBe('dirty'); // Should become dirty due to dependency

    // Get static atom (rebuilds)
    expect(store.get(staticAtom)).toBe(1);
    expect(storeInternal.atomCache.get(staticAtom._id)?._state).toBe('valid');
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBe('dirty'); // Computed remains dirty until accessed

    // Get computed atom (rebuilds)
    expect(store.get(computedAtom)).toBe(2);
    expect(storeInternal.atomCache.get(computedAtom._id)?._state).toBe('valid');
  });

  // TODO: Add tests for model-like atoms with actions
  // TODO: Add tests for family atoms
  // TODO: Add tests for stream atoms
  // TODO: Add tests for dependency tracking and invalidation
  it('should teardown atom when last subscriber unsubscribes', () => {
    const countAtom = atom(0);
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    // Access internal cache for testing (use with caution)
    const storeInternal = store as any;
    const atomId = countAtom._id;

    // Initial get to ensure atom is in cache
    store.get(countAtom);
    expect(storeInternal.atomCache.has(atomId)).toBe(true);

    const unsubscribe1 = store.on(countAtom, listener1);
    const unsubscribe2 = store.on(countAtom, listener2);

    store.set(countAtom, 1);
    expect(listener1).toHaveBeenCalledTimes(2); // Initial + set
    expect(listener2).toHaveBeenCalledTimes(2); // Initial + set

    unsubscribe1();
    store.set(countAtom, 2);
    expect(listener1).toHaveBeenCalledTimes(2);
    expect(listener2).toHaveBeenCalledTimes(3); // Still subscribed

    // Teardown should happen here
    unsubscribe2();
    expect(storeInternal.atomCache.has(atomId)).toBe(false); // Check cache removal

    // Setting after teardown should not throw, but atom will be rebuilt if accessed again
    store.set(countAtom, 3);

    // Re-subscribe, should trigger rebuild and get initial value (which is now 3)
    const listener3 = vi.fn();
    store.on(countAtom, listener3);
    expect(storeInternal.atomCache.has(atomId)).toBe(true); // Back in cache
    expect(listener3).toHaveBeenCalledTimes(1);
    expect(listener3).toHaveBeenCalledWith(3, undefined);
    expect(store.get(countAtom)).toBe(3);

  });

  it('should allow computed atoms to catch and handle dependency errors', () => {
    const errorSourceAtom = atom(() => {
      throw new Error('Dependency Failed');
    });

    const errorHandlerAtom = atom(get => {
      try {
        // The internal getter used during build might return the error object
        const valueOrError = get(errorSourceAtom);
        if (valueOrError instanceof Error) {
          // console.log('Caught error from dependency:', valueOrError.message);
          return 'Handled Error: ' + valueOrError.message;
        }
        // This part should not be reached if the dependency throws
        return 'Dependency OK';
      } catch (e) {
        // This catch block might catch errors thrown by the getter itself (e.g., Suspense promise)
        // or if the internal getter logic changes back to throwing errors.
        // console.error('Caught error via try-catch:', e);
        return 'Handled Error via Catch';
      }
    });

    // Get the error handler atom. It should execute its build function,
    // catch the error from errorSourceAtom using the internal getter,
    // and return the handled value.
    expect(store.get(errorHandlerAtom)).toBe('Handled Error: Dependency Failed');

    // Verify the source atom still reports the error if accessed directly
    expect(() => store.get(errorSourceAtom)).toThrow('Dependency Failed');
  });
  // TODO: Add tests for teardown logic with dependents
  // TODO: Add tests for teardown logic for family instances
  // TODO: Add tests for circular dependencies
});
