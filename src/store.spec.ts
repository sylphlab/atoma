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

  // TODO: Add tests for model-like atoms with actions
  // TODO: Add tests for family atoms
  // TODO: Add tests for stream atoms
  // TODO: Add tests for dependency tracking and invalidation
  // TODO: Add tests for teardown logic
  // TODO: Add tests for circular dependencies
});
