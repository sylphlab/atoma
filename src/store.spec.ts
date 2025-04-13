import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from './store';
import { atom, atomFamily } from './atom'; // Import atomFamily
import { Atom, AtomFamilyTemplate, Getter, Setter } from './types'; // Import AtomFamilyTemplate, Getter, Setter

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

  // --- Tests for Atom Families ---

  it('should get initial value of different atom family members', () => {
    const itemFamilyTemplate = atomFamily((id: number) => `Item ${id}`);
    // Use resolveFamilyInstance to get the specific atom instance
    const item1Instance = (store as any).resolveFamilyInstance(itemFamilyTemplate, 1);
    const item2Instance = (store as any).resolveFamilyInstance(itemFamilyTemplate, 2);

    expect(store.get(item1Instance)).toBe('Item 1');
    expect(store.get(item2Instance)).toBe('Item 2');
    // Ensure accessing the same member returns the same instance/value
    const item1AgainInstance = (store as any).resolveFamilyInstance(itemFamilyTemplate, 1);
    expect(store.get(item1AgainInstance)).toBe('Item 1');
    expect(item1Instance).toBe(item1AgainInstance); // Should be the same cached instance
  });

  it('should treat different family members independently for static values', () => {
    const configFamilyTemplate = atomFamily((key: string) => ({ key, value: `Default ${key}` }));
    const configAInstance = (store as any).resolveFamilyInstance(configFamilyTemplate, 'A');
    const configBInstance = (store as any).resolveFamilyInstance(configFamilyTemplate, 'B');

    expect(store.get(configAInstance)).toEqual({ key: 'A', value: 'Default A' });
    expect(store.get(configBInstance)).toEqual({ key: 'B', value: 'Default B' });
  });

   it('should treat different family members independently for computed values', () => {
    const baseAtom = atom(10);
    const multiplierFamilyTemplate = atomFamily((factor: number) => (get) => get(baseAtom) * factor);

    const doubleInstance = (store as any).resolveFamilyInstance(multiplierFamilyTemplate, 2);
    const tripleInstance = (store as any).resolveFamilyInstance(multiplierFamilyTemplate, 3);

    expect(store.get(doubleInstance)).toBe(20);
    expect(store.get(tripleInstance)).toBe(30);

    store.set(baseAtom, 100);

    expect(store.get(doubleInstance)).toBe(200);
    expect(store.get(tripleInstance)).toBe(300);
  });


  it('should subscribe to changes of a specific family member', () => {
    // Family initializer returns a basic writable atom initializer
    const counterFamilyTemplate = atomFamily((_id: string) => 0);
    const counterAInstance = (store as any).resolveFamilyInstance(counterFamilyTemplate, 'A');
    const counterBInstance = (store as any).resolveFamilyInstance(counterFamilyTemplate, 'B');
    const listenerA = vi.fn();

    const unsubscribeA = store.on(counterAInstance, listenerA);
    expect(listenerA).toHaveBeenCalledTimes(1); // Initial value
    expect(listenerA).toHaveBeenCalledWith(0, undefined);

    store.set(counterAInstance, 1);
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerA).toHaveBeenLastCalledWith(1, undefined);

    // Setting a different family member should not notify listenerA
    store.set(counterBInstance, 5);
    expect(listenerA).toHaveBeenCalledTimes(2);

    unsubscribeA();
    store.set(counterAInstance, 2);
    expect(listenerA).toHaveBeenCalledTimes(2); // Unsubscribed
  });

   it('should teardown specific family member when last subscriber unsubscribes', () => {
    const dataFamilyTemplate = atomFamily((id: string) => `Data ${id}`);
    const dataAInstance = (store as any).resolveFamilyInstance(dataFamilyTemplate, 'A');
    const dataBInstance = (store as any).resolveFamilyInstance(dataFamilyTemplate, 'B');
    const listenerA1 = vi.fn();
    const listenerA2 = vi.fn();
    const listenerB = vi.fn();

    const storeInternal = store as any;
    const atomInstanceAId = dataAInstance._id;
    const atomInstanceBId = dataBInstance._id;

    // Get both to ensure they are in cache
    store.get(dataAInstance);
    store.get(dataBInstance);
    expect(storeInternal.atomCache.has(atomInstanceAId)).toBe(true);
    expect(storeInternal.atomCache.has(atomInstanceBId)).toBe(true);

    const unsubA1 = store.on(dataAInstance, listenerA1);
    const unsubA2 = store.on(dataAInstance, listenerA2);
    const unsubB = store.on(dataBInstance, listenerB);

    expect(storeInternal.atomCache.get(atomInstanceAId)?.subs.size).toBe(2);
    expect(storeInternal.atomCache.get(atomInstanceBId)?.subs.size).toBe(1);

    unsubA1();
    expect(storeInternal.atomCache.get(atomInstanceAId)?.subs.size).toBe(1);
    expect(storeInternal.atomCache.has(atomInstanceAId)).toBe(true); // Still has one sub

    unsubB();
    expect(storeInternal.atomCache.has(atomInstanceBId)).toBe(false); // B should be torn down

    unsubA2(); // Last subscriber for A
    expect(storeInternal.atomCache.has(atomInstanceAId)).toBe(false); // A should be torn down
  });

  it('should handle async atom families', async () => {
    const asyncUserFamilyTemplate = atomFamily(async (userId: number) => {
      await tick();
      if (userId < 0) throw new Error('Invalid ID');
      return { id: userId, name: `User ${userId}` };
    });

    const user1Instance = (store as any).resolveFamilyInstance(asyncUserFamilyTemplate, 1);
    const user2Instance = (store as any).resolveFamilyInstance(asyncUserFamilyTemplate, 2);
    const invalidUserInstance = (store as any).resolveFamilyInstance(asyncUserFamilyTemplate, -1);

    const listener1 = vi.fn();
    store.on(user1Instance, listener1);
    const listener2 = vi.fn();
    store.on(user2Instance, listener2);
    const listenerInvalid = vi.fn();
    store.on(invalidUserInstance, listenerInvalid);

    // Use waitFor to ensure listeners are called and state is updated
    await vi.waitFor(() => {
        expect(listener1).toHaveBeenCalled();
        // Check the last call's value after waiting
        const lastCallArgs = listener1.mock.calls[listener1.mock.calls.length - 1];
        expect(lastCallArgs[0]).toEqual({ id: 1, name: 'User 1' });
        expect(lastCallArgs[1]).toBeUndefined();
    });
     await vi.waitFor(() => {
        expect(listener2).toHaveBeenCalled();
        const lastCallArgs = listener2.mock.calls[listener2.mock.calls.length - 1];
        expect(lastCallArgs[0]).toEqual({ id: 2, name: 'User 2' });
        expect(lastCallArgs[1]).toBeUndefined();
    });
     await vi.waitFor(() => {
        expect(listenerInvalid).toHaveBeenCalled();
        const lastCallArgs = listenerInvalid.mock.calls[listenerInvalid.mock.calls.length - 1];
        expect(lastCallArgs[0]).toBeUndefined();
        expect(lastCallArgs[1]).toBeInstanceOf(Error);
    });


    // Check resolved values after waiting for listeners
    expect(store.get(user1Instance)).toEqual({ id: 1, name: 'User 1' });
    expect(store.get(user2Instance)).toEqual({ id: 2, name: 'User 2' });

    // Check listeners for resolved values
    // Check error handling (already checked via listener wait)
    expect(() => store.get(invalidUserInstance)).toThrow('Invalid ID');
    // Verify the error message from the listener check again for robustness
    const lastCallInvalidArgs = listenerInvalid.mock.calls[listenerInvalid.mock.calls.length - 1];
    expect((lastCallInvalidArgs[1] as Error).message).toBe('Invalid ID');
  });

  it('should handle writable computed atom families', () => {
    // Define a source family first
    const sourcePrefFamily = atomFamily((key: string) => `Default ${key}`);

    // Family initializer returns a writable computed atom definition
    const writablePrefFamilyTemplate = atomFamily((key: string) => {
        const sourceInstance = (store as any).resolveFamilyInstance(sourcePrefFamily, key); // Get the specific source instance
        return { // Return the WritableComputedAtomDefinition
            get: (get: Getter) => `Pref [${key}]: ${get(sourceInstance)}`,
            // Correct: set receives the context object { get, set }
            set: ({ set }, newValue: string) => { // Destructure 'set' from the context object
                const actualValue = newValue.startsWith(`Pref [${key}]: `)
                    ? newValue.substring(`Pref [${key}]: `.length)
                    : newValue;
                set(sourceInstance, actualValue); // Use the destructured 'set' function
            }
        };
    });

    const prefColorInstance = (store as any).resolveFamilyInstance(writablePrefFamilyTemplate, 'color');
    const prefThemeInstance = (store as any).resolveFamilyInstance(writablePrefFamilyTemplate, 'theme');

    // Initial get
    expect(store.get(prefColorInstance)).toBe('Pref [color]: Default color');
    expect(store.get(prefThemeInstance)).toBe('Pref [theme]: Default theme');

    // Set one family member
    store.set(prefColorInstance, 'Pref [color]: blue');
    expect(store.get(prefColorInstance)).toBe('Pref [color]: blue');

    // Setting another family member should not affect the first
    store.set(prefThemeInstance, 'dark'); // Test setting without prefix
    expect(store.get(prefThemeInstance)).toBe('Pref [theme]: dark');
    expect(store.get(prefColorInstance)).toBe('Pref [color]: blue'); // Verify independence

    // Check underlying source atom update by getting the source instance directly
    const sourceColorInstance = (store as any).resolveFamilyInstance(sourcePrefFamily, 'color');
    const sourceThemeInstance = (store as any).resolveFamilyInstance(sourcePrefFamily, 'theme');
    expect(store.get(sourceColorInstance)).toBe('blue');
    expect(store.get(sourceThemeInstance)).toBe('dark');
  });


  // --- Tests for Model-like Atoms ---

  it('should get initial value of a model-like atom', () => {
    const counterModel = atom({
      build: () => ({ count: 0 }),
      actions: {
        inc: (state) => ({ count: state.count + 1 }),
        dec: (state) => ({ count: state.count - 1 }),
      }
    });
    expect(store.get(counterModel)).toEqual({ count: 0 });
  });

  it('should update state using actions from a model-like atom', () => {
    const counterModel = atom({
      build: () => ({ count: 0 }),
      actions: {
        inc: (state) => ({ count: state.count + 1 }),
        add: (state, amount: number) => ({ count: state.count + amount }),
      }
    });

    const actions = store.use(counterModel);

    expect(store.get(counterModel)).toEqual({ count: 0 });

    actions.inc();
    expect(store.get(counterModel)).toEqual({ count: 1 });

    actions.add(5);
    expect(store.get(counterModel)).toEqual({ count: 6 });
  });

  it('should handle async actions in model-like atoms', async () => {
    const userModel = atom({
      build: () => ({ loading: false, data: null as string | null, error: null as Error | null }),
      actions: {
        fetchUser: async (_state, userId: string) => {
          // Return intermediate loading state immediately
          (store as any).internalSetState(userModel, { loading: true, data: null, error: null }); // Use internal set for sync update
          await tick(); // Simulate network delay
          try {
            if (userId === 'error') throw new Error('Fetch failed');
            const userData = `User data for ${userId}`;
            // Return final state on success
            return { loading: false, data: userData, error: null };
          } catch (err) {
            // Return final state on error
            return { loading: false, data: null, error: err as Error };
          }
        }
      }
    });

    const actions = store.use(userModel);
    const listener = vi.fn();
    store.on(userModel, listener);

    expect(store.get(userModel)).toEqual({ loading: false, data: null, error: null });
    expect(listener).toHaveBeenCalledTimes(1); // Initial build

    const fetchPromise = actions.fetchUser('123');

    // Check intermediate loading state (set synchronously via internalSetState)
    expect(store.get(userModel)).toEqual({ loading: true, data: null, error: null });
    expect(listener).toHaveBeenCalledTimes(2); // Notification for loading state
    expect(listener).toHaveBeenLastCalledWith({ loading: true, data: null, error: null }, undefined);

    await fetchPromise; // Wait for the async action to complete

    // Check final success state
    expect(store.get(userModel)).toEqual({ loading: false, data: 'User data for 123', error: null });
    expect(listener).toHaveBeenCalledTimes(3); // Notification for final state
    expect(listener).toHaveBeenLastCalledWith({ loading: false, data: 'User data for 123', error: null }, undefined);

    // Test error case
    const fetchErrorPromise = actions.fetchUser('error');
    expect(store.get(userModel)).toEqual({ loading: true, data: null, error: null }); // Loading state again
    expect(listener).toHaveBeenCalledTimes(4); // Notification for loading state

    await fetchErrorPromise; // Wait for error action

    expect(store.get(userModel).loading).toBe(false);
    expect(store.get(userModel).data).toBeNull();
    expect(store.get(userModel).error).toBeInstanceOf(Error);
    expect((store.get(userModel).error as Error).message).toBe('Fetch failed');
    expect(listener).toHaveBeenCalledTimes(5); // Notification for error state
    const lastCallArgs = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCallArgs[0].error).toBeInstanceOf(Error);
    expect((lastCallArgs[0].error as Error).message).toBe('Fetch failed');

  });

   it('should subscribe to state changes triggered by model actions', () => {
    const counterModel = atom({
      build: () => ({ count: 0 }),
      actions: {
        inc: (state) => ({ count: state.count + 1 }),
      }
    });
    const actions = store.use(counterModel);
    const listener = vi.fn();

    const unsubscribe = store.on(counterModel, listener);
    expect(listener).toHaveBeenCalledTimes(1); // Initial build
    expect(listener).toHaveBeenCalledWith({ count: 0 }, undefined);

    actions.inc();
    expect(listener).toHaveBeenCalledTimes(2); // After action
    expect(listener).toHaveBeenLastCalledWith({ count: 1 }, undefined);

    actions.inc();
    expect(listener).toHaveBeenCalledTimes(3); // After second action
    expect(listener).toHaveBeenLastCalledWith({ count: 2 }, undefined);

    unsubscribe();
    actions.inc();
    expect(listener).toHaveBeenCalledTimes(3); // Unsubscribed
  });

  it('should throw error when trying to set a model-like atom directly', () => {
    const modelAtom = atom({
      build: () => ({ value: 1 }),
      actions: { doSomething: state => state }
    });
    expect(() => store.set(modelAtom, { value: 2 })).toThrow('Cannot set model-like atom directly');
  });

  // TODO: Add tests for model-like atoms with actions (Covered Above)
  // --- Mock Observable for testing ---
class MockObservable<T> {
  private observers: Set<(value: T) => void> = new Set();
  private errorObservers: Set<(error: any) => void> = new Set();
  private completeObservers: Set<() => void> = new Set();
  public active = true;
  public lastValue: T | undefined = undefined;

  subscribe(observer: { next?: (value: T) => void, error?: (error: any) => void, complete?: () => void }) {
    if (!this.active) return { unsubscribe: () => {} }; // Don't subscribe if already completed/errored

    if (observer.next) this.observers.add(observer.next);
    if (observer.error) this.errorObservers.add(observer.error);
    if (observer.complete) this.completeObservers.add(observer.complete);

    // Emit last value immediately if it exists (like BehaviorSubject)
    if (this.lastValue !== undefined && observer.next) {
         try { observer.next(this.lastValue); } catch(e) { console.error("Error in mock observable immediate emit:", e); }
    }


    const unsubscribe = () => {
      if (observer.next) this.observers.delete(observer.next);
      if (observer.error) this.errorObservers.delete(observer.error);
      if (observer.complete) this.completeObservers.delete(observer.complete);
    };
    return { unsubscribe };
  }

  next(value: T) {
    if (!this.active) return;
    this.lastValue = value;
    this.observers.forEach(obs => { try { obs(value); } catch(e) { console.error("Error in mock observable next:", e); } });
  }

  error(err: any) {
    if (!this.active) return;
    this.active = false;
    this.errorObservers.forEach(obs => { try { obs(err); } catch(e) { console.error("Error in mock observable error:", e); } });
    this.clearObservers();
  }

  complete() {
    if (!this.active) return;
    this.active = false;
    this.completeObservers.forEach(obs => { try { obs(); } catch(e) { console.error("Error in mock observable complete:", e); } });
    this.clearObservers();
  }

  private clearObservers() {
      this.observers.clear();
      this.errorObservers.clear();
      this.completeObservers.clear();
  }
}

// --- Mock Async Iterable for testing ---
async function* mockAsyncIterable<T>(values: T[], delay = 1, errorAfter?: number, complete = true) {
  let count = 0;
  for (const value of values) {
    await new Promise(res => setTimeout(res, delay));
    yield value;
    count++;
    if (errorAfter !== undefined && count >= errorAfter) {
      throw new Error(`AsyncIterable failed after ${count} items`);
    }
  }
  if (complete) {
      // console.log("Mock AsyncIterable completed");
  } else {
      // Simulate never completing
      // console.log("Mock AsyncIterable starting infinite wait");
      await new Promise(() => {});
  }
}


  // --- Tests for Stream Atoms ---

  it('should handle Observable-like stream atoms', async () => {
    const source = new MockObservable<number>();
    const streamAtom = atom(() => source); // Initializer returns the observable
    const listener = vi.fn();

    const unsubscribe = store.on(streamAtom, listener);

    // Observable might emit last value immediately upon subscription
    if (source.lastValue !== undefined) {
        expect(listener).toHaveBeenCalledWith(source.lastValue, undefined);
    } else {
        // Initial call might be with undefined if no initial value
        expect(listener).toHaveBeenCalledTimes(1);
        // Initial state might be undefined or pending
    }


    source.next(1);
    await tick(); // Allow notification microtask
    expect(listener).toHaveBeenLastCalledWith(1, undefined);
    expect(store.get(streamAtom)).toBe(1);

    source.next(2);
    await tick();
    expect(listener).toHaveBeenLastCalledWith(2, undefined);
    expect(store.get(streamAtom)).toBe(2);

    unsubscribe();
    source.next(3); // Should not trigger listener
    await tick();
    expect(listener).toHaveBeenCalledTimes(listener.mock.calls.length); // Count shouldn't increase

    // Re-subscribe should get the last value (2)
    const listener2 = vi.fn();
    store.on(streamAtom, listener2);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledWith(2, undefined); // BehaviorSubject-like behavior
  });

  it('should handle errors from Observable-like stream atoms', async () => {
    const source = new MockObservable<number>();
    const streamAtom = atom(() => source);
    const listener = vi.fn();

    store.on(streamAtom, listener);

    source.next(1);
    await tick();
    expect(listener).toHaveBeenLastCalledWith(1, undefined);

    const testError = new Error('Stream failed');
    source.error(testError);
    await tick();

    // Check listener called with error
    const lastCallArgs = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCallArgs[0]).toBeUndefined(); // No value on error
    expect(lastCallArgs[1]).toBe(testError);

    // Check store.get throws the error
    expect(() => store.get(streamAtom)).toThrow('Stream failed');
  });

   it('should handle completion of Observable-like stream atoms', async () => {
    const source = new MockObservable<number>();
    const streamAtom = atom(() => source);
    const listener = vi.fn();

    store.on(streamAtom, listener);

    source.next(1);
    await tick();
    expect(listener).toHaveBeenLastCalledWith(1, undefined);
    expect(store.get(streamAtom)).toBe(1);

    source.complete();
    await tick();

    // Listener might not be called on complete, depends on desired behavior.
    // Let's assume it's not called again, but the state is retained.
    expect(listener).toHaveBeenCalledTimes(listener.mock.calls.length); // Count shouldn't increase

    // Value should remain the last emitted value
    expect(store.get(streamAtom)).toBe(1);

    // Further emissions should be ignored
    source.next(2);
    await tick();
    expect(store.get(streamAtom)).toBe(1); // Still 1
    expect(listener).toHaveBeenCalledTimes(listener.mock.calls.length);
  });

  it('should teardown Observable subscription when last subscriber unsubscribes', () => {
    const source = new MockObservable<number>();
    const streamAtom = atom(() => source);
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = store.on(streamAtom, listener1);
    const unsub2 = store.on(streamAtom, listener2);

    source.next(1);
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();

    unsub1();
    source.next(2);
    expect(listener2).toHaveBeenCalledTimes(listener2.mock.calls.length); // listener2 still active

    // Check internal state (requires access, maybe spy on unsubscribe?)
    // For now, assume internal cleanup happens.

    unsub2(); // Last unsubscribe
    source.next(3);
    // No listeners should be called.
    // How to verify source subscription is cleaned up? Difficult without mocks/spies on source.
    // We rely on the store's internal AbortController logic.
    const storeInternal = store as any;
    const instance = storeInternal.atomCache.get(streamAtom._id);
    // After teardown, the instance should be removed from cache
    expect(storeInternal.atomCache.has(streamAtom._id)).toBe(false);
  });


  it('should handle AsyncIterable stream atoms', async () => {
    const sourceIterable = mockAsyncIterable([10, 20, 30], 1);
    const streamAtom = atom(() => sourceIterable);
    const listener = vi.fn();

    store.on(streamAtom, listener);

    // Initial state might be pending/undefined
    expect(listener).toHaveBeenCalledTimes(1); // Initial call

    // Wait for values
    await tick(); // Allow iteration 1
    expect(listener).toHaveBeenLastCalledWith(10, undefined);
    expect(store.get(streamAtom)).toBe(10);

    await tick(); // Allow iteration 2
    expect(listener).toHaveBeenLastCalledWith(20, undefined);
    expect(store.get(streamAtom)).toBe(20);

    await tick(); // Allow iteration 3
    expect(listener).toHaveBeenLastCalledWith(30, undefined);
    expect(store.get(streamAtom)).toBe(30);

    await tick(); // Allow completion check
     // Listener might not be called on completion. Value remains.
    expect(listener).toHaveBeenCalledTimes(4); // Initial + 3 values
    expect(store.get(streamAtom)).toBe(30);
  });

  it('should handle errors from AsyncIterable stream atoms', async () => {
    const sourceIterable = mockAsyncIterable([1, 2], 1, 2); // Error after 2 items
    const streamAtom = atom(() => sourceIterable);
    const listener = vi.fn();

    store.on(streamAtom, listener);

    await tick(); // Value 1
    expect(listener).toHaveBeenLastCalledWith(1, undefined);
    expect(store.get(streamAtom)).toBe(1);

    await tick(); // Value 2
    // Listener should have been called with [2, undefined] here
    // We check the *next* call after the error occurs

    expect(store.get(streamAtom)).toBe(2);

    await tick(); // Error occurs during this tick's iteration

    // Check listener was called with error after the last successful value
    const errorCallArgs = listener.mock.calls[listener.mock.calls.length - 1];
    expect(errorCallArgs[0]).toBeUndefined(); // No value on error
    expect(errorCallArgs[1]).toBeInstanceOf(Error);
    expect((errorCallArgs[1] as Error).message).toBe('AsyncIterable failed after 2 items');

    // Check store.get throws the error
    expect(() => store.get(streamAtom)).toThrow('AsyncIterable failed after 2 items');
  });

  it('should teardown AsyncIterable when last subscriber unsubscribes', async () => {
      const sourceIterable = mockAsyncIterable([1, 2, 3, 4, 5], 1, undefined, false); // Never completes
      const streamAtom = atom(() => sourceIterable);
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsub1 = store.on(streamAtom, listener1);
      const unsub2 = store.on(streamAtom, listener2);

      await tick(); // Value 1
      expect(listener1).toHaveBeenLastCalledWith(1, undefined);
      expect(listener2).toHaveBeenLastCalledWith(1, undefined);

      unsub1();

      await tick(); // Value 2
      expect(listener1).toHaveBeenCalledTimes(2); // Should not be called again
      expect(listener2).toHaveBeenLastCalledWith(2, undefined);

      unsub2(); // Last unsubscribe, should trigger abort

      await tick(); // Value 3 would have been emitted if not aborted

      // Verify atom is removed from cache (indicates teardown)
      const storeInternal = store as any;
      expect(storeInternal.atomCache.has(streamAtom._id)).toBe(false);

      // How to verify the iterable itself stopped? Difficult. Rely on AbortController.
  });

  // TODO: Add tests for stream atoms (Covered Above)

  // --- Tests for Dependency Tracking and Invalidation ---

  it('should correctly track complex dependencies', () => {
    const a = atom(1);
    const b = atom(get => get(a) + 1); // b depends on a
    const c = atom(get => get(a) + 10); // c depends on a
    const d = atom(get => get(b) + get(c)); // d depends on b and c

    const storeInternal = store as any;

    // Initial gets to build dependencies
    expect(store.get(d)).toBe(13); // 1 + 1 + 1 + 10 = 13

    const instanceA = storeInternal.atomCache.get(a._id);
    const instanceB = storeInternal.atomCache.get(b._id);
    const instanceC = storeInternal.atomCache.get(c._id);
    const instanceD = storeInternal.atomCache.get(d._id);

    // Check dependents
    expect(instanceA._dependents.has(instanceB)).toBe(true);
    expect(instanceA._dependents.has(instanceC)).toBe(true);
    expect(instanceA._dependents.has(instanceD)).toBe(false); // d depends indirectly
    expect(instanceB._dependents.has(instanceD)).toBe(true);
    expect(instanceC._dependents.has(instanceD)).toBe(true);

    // Check dependencies
    expect(instanceD._dependencies.has(instanceB)).toBe(true);
    expect(instanceD._dependencies.has(instanceC)).toBe(true);
    expect(instanceD._dependencies.has(instanceA)).toBe(false); // d depends indirectly
    expect(instanceB._dependencies.has(instanceA)).toBe(true);
    expect(instanceC._dependencies.has(instanceA)).toBe(true);
  });

  it('should invalidate dependents correctly when a dependency changes', () => {
    const a = atom(1);
    const b = atom(get => get(a) + 1); // b depends on a
    const c = atom(get => get(a) + 10); // c depends on a
    const d = atom(get => get(b) + get(c)); // d depends on b and c

    const storeInternal = store as any;

    // Initial get
    store.get(d);
    const instanceA = storeInternal.atomCache.get(a._id);
    const instanceB = storeInternal.atomCache.get(b._id);
    const instanceC = storeInternal.atomCache.get(c._id);
    const instanceD = storeInternal.atomCache.get(d._id);

    expect(instanceA._state).toBe('valid');
    expect(instanceB._state).toBe('valid');
    expect(instanceC._state).toBe('valid');
    expect(instanceD._state).toBe('valid');

    // Set 'a', which should invalidate b, c, and d
    store.set(a, 2);

    // Check states after set (propagation should mark dependents as dirty)
    expect(instanceA._state).toBe('valid'); // a is valid because it was set directly
    expect(instanceB._state).toBe('dirty');
    expect(instanceC._state).toBe('dirty');
    expect(instanceD._state).toBe('dirty');

    // Get 'd' again, should trigger rebuilds
    expect(store.get(d)).toBe(15); // Correct calculation: (2+1) + (2+10) = 15

    // Check states after get (all should be valid now)
    expect(instanceA._state).toBe('valid');
    expect(instanceB._state).toBe('valid');
    expect(instanceC._state).toBe('valid');
    expect(instanceD._state).toBe('valid');
  });

  it('should only rebuild necessary atoms based on state', () => {
      const a = atom(1);
      const b = atom(get => get(a) + 1);
      const c = atom(get => get(a) + 10);
      const d = atom(get => get(b) + get(c));

      const storeInternal = store as any;

      // Function to get atom state from cache
      const getState = (atm: Atom<any>) => storeInternal.atomCache.get(atm._id)?._state;

      // Initial get of d builds everything
      store.get(d);
      expect(getState(a)).toBe('valid');
      expect(getState(b)).toBe('valid');
      expect(getState(c)).toBe('valid');
      expect(getState(d)).toBe('valid');

      // Get d again, should not change state (already valid)
      store.get(d);
      expect(getState(a)).toBe('valid');
      expect(getState(b)).toBe('valid');
      expect(getState(c)).toBe('valid');
      expect(getState(d)).toBe('valid');

      // Set a, invalidates b, c, d
      store.set(a, 2);
      expect(getState(a)).toBe('valid'); // a is valid (set directly)
      expect(getState(b)).toBe('dirty');
      expect(getState(c)).toBe('dirty');
      expect(getState(d)).toBe('dirty');

      // Get b, should rebuild b only
      store.get(b);
      expect(getState(a)).toBe('valid');
      expect(getState(b)).toBe('valid'); // b becomes valid
      expect(getState(c)).toBe('dirty'); // c remains dirty
      expect(getState(d)).toBe('dirty'); // d remains dirty

      // Get d, should rebuild c and d (b is already valid)
      store.get(d);
      expect(getState(a)).toBe('valid');
      expect(getState(b)).toBe('valid');
      expect(getState(c)).toBe('valid'); // c becomes valid
      expect(getState(d)).toBe('valid'); // d becomes valid
  });

  it('should handle dynamic dependencies', () => {
      const switchAtom = atom(true);
      const atomA = atom(10);
      const atomB = atom(20);
      const conditionalAtom = atom(get => {
          if (get(switchAtom)) {
              return get(atomA);
          } else {
              return get(atomB);
          }
      });

      const storeInternal = store as any;

      // Initial get, depends on switchAtom and atomA
      expect(store.get(conditionalAtom)).toBe(10);
      const instanceConditional = storeInternal.atomCache.get(conditionalAtom._id);
      const instanceA = storeInternal.atomCache.get(atomA._id);
      const instanceB = storeInternal.atomCache.get(atomB._id);
      const instanceSwitch = storeInternal.atomCache.get(switchAtom._id);

      expect(instanceConditional._dependencies.has(instanceSwitch)).toBe(true);
      expect(instanceConditional._dependencies.has(instanceA)).toBe(true);
      expect(instanceConditional._dependencies.has(instanceB)).toBe(false); // Not depended on yet

      // Change atomB, should not affect conditionalAtom yet
      store.set(atomB, 25);
      expect(instanceConditional._state).toBe('valid'); // Still valid
      expect(store.get(conditionalAtom)).toBe(10); // Value unchanged

      // Flip the switch, now depends on switchAtom and atomB
      store.set(switchAtom, false);
      expect(instanceConditional._state).toBe('dirty'); // Becomes dirty due to switch change

      // Get conditionalAtom again, rebuilds and changes dependency
      expect(store.get(conditionalAtom)).toBe(25); // Now uses atomB's value
      expect(instanceConditional._state).toBe('valid');
      expect(instanceConditional._dependencies.has(instanceSwitch)).toBe(true);
      expect(instanceConditional._dependencies.has(instanceA)).toBe(false); // Dependency on A removed
      expect(instanceConditional._dependencies.has(instanceB)).toBe(true); // Dependency on B added

      // Change atomA, should not affect conditionalAtom now
      store.set(atomA, 15);
      expect(instanceConditional._state).toBe('valid'); // Still valid
      expect(store.get(conditionalAtom)).toBe(25); // Value unchanged
  });

  // TODO: Add tests for dependency tracking and invalidation (more complex scenarios) (Covered Above)
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

  it('should allow computed atoms to catch and handle dependency errors via try-catch', () => {
    const errorSourceAtom = atom(() => {
      // console.log("Building errorSourceAtom - throwing error");
      throw new Error('Dependency Failed');
    });

    const errorHandlerAtom = atom(get => {
      // console.log("Building errorHandlerAtom");
      try {
        // Internal getter now throws the error from errorSourceAtom
        const value = get(errorSourceAtom);
        // This part should not be reached if the dependency throws
        // console.log("errorHandlerAtom: Dependency OK, value:", value);
        return `Dependency OK: ${value}`;
      } catch (e) {
        // console.log("errorHandlerAtom: Caught error via try-catch:", e);
        if (e instanceof Error) {
          return 'Handled Error: ' + e.message;
        }
        return 'Handled Unknown Error';
      }
    });

    // Get the error handler atom. It should execute its build function,
    // call get(errorSourceAtom), which throws, catch the error,
    // and return the handled value.
    expect(store.get(errorHandlerAtom)).toBe('Handled Error: Dependency Failed');

    // Verify the source atom still throws the error if accessed directly
    expect(() => store.get(errorSourceAtom)).toThrow('Dependency Failed');
  });
  // TODO: Add tests for teardown logic with dependents
  // TODO: Add tests for teardown logic for family instances
  // --- Tests for Circular Dependencies ---

  it('should detect simple direct circular dependencies', () => {
    // Atom 'a' depends on 'b', and 'b' depends on 'a'
    // Need to declare types explicitly because TS can't infer recursive types easily
    let a: Atom<number>;
    let b: Atom<number>;
    a = atom(get => get(b) + 1);
    b = atom(get => get(a) + 1);


    // Accessing either should throw a circular dependency error
    expect(() => store.get(a)).toThrow(/Circular dependency detected/);
    // Reset store or use a new one if the error state persists internally
    store = new Store(); // Use a fresh store
    expect(() => store.get(b)).toThrow(/Circular dependency detected/);
  });

  it('should detect indirect circular dependencies', () => {
    // a -> b -> c -> a
    let a: Atom<number>;
    let b: Atom<number>;
    let c: Atom<number>;
    a = atom(get => get(c) + 1);
    b = atom(get => get(a) + 1);
    c = atom(get => get(b) + 1);

    expect(() => store.get(a)).toThrow(/Circular dependency detected/);
    store = new Store();
    expect(() => store.get(b)).toThrow(/Circular dependency detected/);
    store = new Store();
    expect(() => store.get(c)).toThrow(/Circular dependency detected/);
  });

   it('should allow accessing an atom within its own writable computed setter', () => {
    // This is not a circular dependency, but tests interaction within a setter
    const countAtom = atom(0);
    const writableAtom = atom<number>({
      get: (get) => get(countAtom),
      set: ({ get, set }, newValue) => {
        // Need to access the *instance* state, not call get(writableAtom) which would cause infinite loop
        const instance = (store as any).resolveAtomInstance(writableAtom);
        const currentValue = instance._value; // Access internal value directly
        // console.log(`Setter: current=${currentValue}, new=${newValue}`);
        if (newValue > currentValue) {
          set(countAtom, newValue);
        } else {
          // console.log("Setter: New value not greater, not setting.");
        }
      }
    });

    expect(store.get(writableAtom)).toBe(0);
    store.set(writableAtom, 5); // Should update countAtom to 5
    expect(store.get(countAtom)).toBe(5);
    expect(store.get(writableAtom)).toBe(5);

    store.set(writableAtom, 3); // Should not update countAtom (3 is not > 5)
    expect(store.get(countAtom)).toBe(5);
    expect(store.get(writableAtom)).toBe(5);

     store.set(writableAtom, 10); // Should update countAtom to 10
    expect(store.get(countAtom)).toBe(10);
    expect(store.get(writableAtom)).toBe(10);
  });

  // TODO: Add tests for teardown logic with dependents (partially covered by invalidation tests)
  // TODO: Add tests for teardown logic for family instances (covered)
  // TODO: Add tests for circular dependencies (Covered Above)
  // TODO: Add tests for circular dependencies
}); // Close outer describe block
