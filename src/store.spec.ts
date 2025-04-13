import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from './store';
import { atom } from './atom';
import { Atom, Getter, Setter, AtomContext, FamilyMemberAtomDescriptor, isFamilyMemberDescriptor, WritableComputedAtomDefinition } from './types'; // Added WritableComputedAtomDefinition

// Helper function to wait for promises to settle in tests
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  // --- Basic Atom Tests ---

  it('should get initial value of a static atom', () => {
    const countAtom = atom(0); // Returns Atom<number>
    expect(store.get(countAtom)).toBe(0);
  });

  it('should set and get value of a static atom', () => {
    const countAtom = atom(0); // Returns Atom<number>
    store.set(countAtom, 5);
    expect(store.get(countAtom)).toBe(5);
  });

  it('should get initial value of a computed atom', () => {
    const countAtom = atom(5);
    const doubleAtom = atom(get => get(countAtom) * 2); // Returns Atom<number>
    expect(store.get(doubleAtom)).toBe(10);
  });

  it('should update computed atom when dependency changes', () => {
    const countAtom = atom(5);
    const doubleAtom = atom(get => get(countAtom) * 2); // Returns Atom<number>
    expect(store.get(doubleAtom)).toBe(10);
    store.set(countAtom, 10);
    expect(store.get(doubleAtom)).toBe(20);
  });

  it('should subscribe to atom changes', () => {
    const countAtom = atom(0); // Returns Atom<number>
    const listener = vi.fn();
    const unsubscribe = store.on(countAtom as Atom<any>, listener); // Cast to any
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(0, undefined);
    store.set(countAtom, 1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(1, undefined);
    store.set(countAtom, 2);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(2, undefined);
    unsubscribe();
    store.set(countAtom, 3);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  // --- Async Atom Tests ---

  it('should handle basic async atoms', async () => {
    const asyncAtom = atom(async (ctx: AtomContext) => { // Returns Atom<Promise<string>>
      await tick();
      return 'async value';
    });
    let error: unknown;
    try {
      store.get(asyncAtom);
    } catch (e) {
      if (e instanceof Promise) {
        await e; await tick();
      } else { error = e; }
    }
    expect(error).toBeUndefined();
    expect(store.get(asyncAtom)).toBe('async value');
  });

  it('should notify subscribers of async atom resolution', async () => {
    const asyncAtom = atom(async (ctx: AtomContext) => { // Returns Atom<Promise<string>>
      await tick();
      return 'resolved';
    });
    const listener = vi.fn();
    store.on(asyncAtom as Atom<any>, listener); // Cast to any
    await vi.waitFor(() => {
        const lastCall = listener.mock.calls.find(call => call[0] === 'resolved');
        expect(lastCall).toBeDefined();
        expect(lastCall?.[1]).toBeUndefined();
    });
  });

  it('should handle async atom errors', async () => {
    const errorAtom = atom(async (ctx: AtomContext) => { // Returns Atom<Promise<never>>
      await tick();
      throw new Error('Async failed');
    });
    const listener = vi.fn();
    store.on(errorAtom as Atom<any>, listener); // Cast to any
    let caughtError: unknown;
    try {
      store.get(errorAtom);
    } catch (e) {
      if (e instanceof Promise) {
        try { await e; } catch (innerError) { caughtError = innerError; }
      } else { caughtError = e; }
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('Async failed');
    await vi.waitFor(() => {
        const lastCall = listener.mock.calls.find(call => call[1] instanceof Error);
        expect(lastCall).toBeDefined();
        expect((lastCall?.[1] as Error).message).toBe('Async failed');
    });
    expect(() => store.get(errorAtom)).toThrow('Async failed');
  });

  // --- Writable Computed Atom Tests ---

  it('should handle writable computed atoms', () => {
    const sourceAtom = atom(10);
    const writableComputed = atom<number>({ // Returns Atom<number>
      get: (get) => get(sourceAtom) * 2,
      set: ({ set }, newValue) => { set(sourceAtom, (newValue as number) / 2); } // Add type assertion
    });
    expect(store.get(writableComputed)).toBe(20);
    store.set(writableComputed, 50);
    expect(store.get(writableComputed)).toBe(50);
    expect(store.get(sourceAtom)).toBe(25);
    const listener = vi.fn();
    const unsubscribe = store.on(writableComputed as Atom<any>, listener); // Cast to any
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(50, undefined);
    store.set(sourceAtom, 30);
    expect(store.get(writableComputed)).toBe(60);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(60, undefined);
    unsubscribe();
  });

  // --- State Transition Tests ---
  it('should manage atom state transitions correctly', () => {
    const staticAtom = atom(1);
    const computedAtom = atom(get => get(staticAtom) + 1); // Returns Atom<number>
    const storeInternal = store as any;
    // Helper to get internal instance, cast needed due to specific types returned by atom()
    const getInstance = <T>(a: Atom<T> | FamilyMemberAtomDescriptor<T>) => storeInternal.resolveAtomInstance(a as Atom<any> | FamilyMemberAtomDescriptor<any>);

    // Use the atom directly, not the invoker
    expect(getInstance(staticAtom)._state).toBe('idle');
    expect(getInstance(computedAtom)._state).toBe('idle');

    store.get(staticAtom);
    expect(getInstance(staticAtom)._state).toBe('valid');

    store.get(computedAtom);
    expect(getInstance(computedAtom)._state).toBe('valid');
    expect(getInstance(staticAtom)._state).toBe('valid');

    storeInternal.invalidateAtom(getInstance(computedAtom));
    expect(getInstance(computedAtom)._state).toBe('dirty');
    expect(getInstance(staticAtom)._state).toBe('valid');

    expect(store.get(computedAtom)).toBe(2);
    expect(getInstance(computedAtom)._state).toBe('valid');

    storeInternal.invalidateAtom(getInstance(staticAtom));
    expect(getInstance(staticAtom)._state).toBe('dirty');
    expect(getInstance(computedAtom)._state).toBe('dirty');

    expect(store.get(staticAtom)).toBe(1);
    expect(getInstance(staticAtom)._state).toBe('valid');
    expect(getInstance(computedAtom)._state).toBe('dirty');

    expect(store.get(computedAtom)).toBe(2);
    expect(getInstance(computedAtom)._state).toBe('valid');
  });

  // --- Tests for Atom Families (New API) ---

  it('should get initial value of different atom family members', () => {
    // Define family template: returns FamilyInvoker
    const itemFamilyTemplate = atom((ctx: AtomContext, id: number) => {
        return `Item ${id}`; // Return the initializer (static value)
    });

    // Use the invoker to get the descriptor
    const item1Descriptor = itemFamilyTemplate(1);
    const item2Descriptor = itemFamilyTemplate(2);

    expect(isFamilyMemberDescriptor(item1Descriptor)).toBe(true); // Verify it's a descriptor
    expect(store.get(item1Descriptor)).toBe('Item 1');
    expect(store.get(item2Descriptor)).toBe('Item 2');

    const item1AgainDescriptor = itemFamilyTemplate(1);
    expect(store.get(item1AgainDescriptor)).toBe('Item 1');

    // Check internal instance caching
    const instance1 = (store as any).resolveAtomInstance(item1Descriptor);
    const instance1Again = (store as any).resolveAtomInstance(item1AgainDescriptor);
    expect(instance1).toBe(instance1Again);
    expect(instance1._lastParam).toBe(1); // Check param stored on instance
  });

  it('should treat different family members independently for static values', () => {
    const configFamilyTemplate = atom((ctx: AtomContext, key: string) => {
        return { key, value: `Default ${key}` };
    });
    const configA = configFamilyTemplate('A');
    const configB = configFamilyTemplate('B');

    expect(store.get(configA)).toEqual({ key: 'A', value: 'Default A' });
    expect(store.get(configB)).toEqual({ key: 'B', value: 'Default B' });
  });

   it('should treat different family members independently for computed values', () => {
    const baseAtom = atom(10);
    const multiplierFamilyTemplate = atom((ctx: AtomContext, factor: number) => {
        // Return the computed initializer function
        return (get: Getter) => get(baseAtom) * factor;
    });

    const double = multiplierFamilyTemplate(2);
    const triple = multiplierFamilyTemplate(3);

    expect(store.get(double)).toBe(20);
    expect(store.get(triple)).toBe(30);

    store.set(baseAtom, 100);

    expect(store.get(double)).toBe(200);
    expect(store.get(triple)).toBe(300);
  });


  it('should subscribe to changes of a specific family member', () => {
    const counterFamilyTemplate = atom((ctx: AtomContext, _id: string) => 0); // Returns initializer 0

    const counterA = counterFamilyTemplate('A');
    const counterB = counterFamilyTemplate('B');
    const listenerA = vi.fn();

    const unsubscribeA = store.on(counterA, listenerA); // Descriptor is fine here
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerA).toHaveBeenCalledWith(0, undefined);

    store.set(counterA, 1); // Pass descriptor
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerA).toHaveBeenLastCalledWith(1, undefined);

    store.set(counterB, 5); // Pass descriptor for B
    expect(listenerA).toHaveBeenCalledTimes(2); // A listener not called

    unsubscribeA();
    store.set(counterA, 2);
    expect(listenerA).toHaveBeenCalledTimes(2);
  });

   it('should teardown specific family member when last subscriber unsubscribes', () => {
    const dataFamilyTemplate = atom((ctx: AtomContext, id: string) => `Data ${id}`);
    const dataA = dataFamilyTemplate('A');
    const dataB = dataFamilyTemplate('B');
    const listenerA1 = vi.fn();
    const listenerA2 = vi.fn();
    const listenerB = vi.fn();
    const storeInternal = store as any;

    // Resolve instances using descriptors to check cache
    const instanceA = storeInternal.resolveAtomInstance(dataA);
    const instanceB = storeInternal.resolveAtomInstance(dataB);
    const atomInstanceAId = instanceA._id;
    const atomInstanceBId = instanceB._id;

    expect(storeInternal.atomCache.has(atomInstanceAId)).toBe(true);
    expect(storeInternal.atomCache.has(atomInstanceBId)).toBe(true);

    const unsubA1 = store.on(dataA, listenerA1); // Descriptor is fine here
    const unsubA2 = store.on(dataA, listenerA2); // Descriptor is fine here
    const unsubB = store.on(dataB, listenerB);   // Descriptor is fine here

    expect(storeInternal.atomCache.get(atomInstanceAId)?._subscribers.size).toBe(2);
    expect(storeInternal.atomCache.get(atomInstanceBId)?._subscribers.size).toBe(1);

    unsubA1();
    expect(storeInternal.atomCache.get(atomInstanceAId)?._subscribers.size).toBe(1);
    expect(storeInternal.atomCache.has(atomInstanceAId)).toBe(true);

    unsubB();
    expect(storeInternal.atomCache.has(atomInstanceBId)).toBe(false); // B torn down

    unsubA2();
    expect(storeInternal.atomCache.has(atomInstanceAId)).toBe(false); // A torn down
  });

  it('should handle async atom families', async () => {
    const asyncUserFamilyTemplate = atom((ctx: AtomContext, userId: number) => { // Returns async function initializer
      return async () => {
          await tick();
          if (userId < 0) throw new Error('Invalid ID');
          return { id: userId, name: `User ${userId}` };
      };
    });

    const user1 = asyncUserFamilyTemplate(1);
    const user2 = asyncUserFamilyTemplate(2);
    const invalidUser = asyncUserFamilyTemplate(-1);

    const listener1 = vi.fn(); store.on(user1, listener1); // Descriptor is fine here
    const listener2 = vi.fn(); store.on(user2, listener2); // Descriptor is fine here
    const listenerInvalid = vi.fn(); store.on(invalidUser, listenerInvalid); // Descriptor is fine here

    await vi.waitFor(() => expect(listener1).toHaveBeenLastCalledWith({ id: 1, name: 'User 1' }, undefined));
    await vi.waitFor(() => expect(listener2).toHaveBeenLastCalledWith({ id: 2, name: 'User 2' }, undefined));
    await vi.waitFor(() => {
        const lastCall = listenerInvalid.mock.calls.find(call => call[1] instanceof Error);
        expect(lastCall).toBeDefined();
        expect((lastCall?.[1] as Error).message).toBe('Invalid ID');
    });

    expect(store.get(user1)).toEqual({ id: 1, name: 'User 1' });
    expect(store.get(user2)).toEqual({ id: 2, name: 'User 2' });
    expect(() => store.get(invalidUser)).toThrow('Invalid ID');
  });

  it('should handle writable computed atom families', () => {
    // Source family
    const sourcePrefFamily = atom((ctx: AtomContext, key: string) => `Default ${key}`);

    // Writable computed family template
    // Correctly define writable computed family: initializer returns the definition object
    // Remove explicit return type annotation, let TS infer
    const writablePrefFamilyTemplate = atom<string, [string]>((ctx: AtomContext, key: string) => {
        return {
            get: (get: Getter) => {
                const sourceDesc = sourcePrefFamily(key);
                return `Pref [${key}]: ${get(sourceDesc)}`;
            },
            // Use store.set directly, not the context's set helper
            set: (context, newValue: string) => {
                const sourceDesc = sourcePrefFamily(key);
                const actualValue = newValue.startsWith(`Pref [${key}]: `)
                    ? newValue.substring(`Pref [${key}]: `.length)
                    : newValue;
                store.set(sourceDesc, actualValue); // Use store instance directly
            }
        };
    });

    const prefColor = writablePrefFamilyTemplate('color');
    const prefTheme = writablePrefFamilyTemplate('theme');

    expect(store.get(prefColor)).toBe('Pref [color]: Default color');
    expect(store.get(prefTheme)).toBe('Pref [theme]: Default theme');

    store.set(prefColor, 'Pref [color]: blue');
    expect(store.get(prefColor)).toBe('Pref [color]: blue');

    store.set(prefTheme, 'dark');
    expect(store.get(prefTheme)).toBe('Pref [theme]: dark');
    expect(store.get(prefColor)).toBe('Pref [color]: blue');

    // Check underlying source atoms using their descriptors
    expect(store.get(sourcePrefFamily('color'))).toBe('blue');
    expect(store.get(sourcePrefFamily('theme'))).toBe('dark');
  });


  // --- Tests for Model-like Atoms ---

  it('should get initial value of a model-like atom', () => {
    const counterModel = atom({ // Non-family model
      build: () => ({ count: 0 }),
      actions: { inc: (s) => ({ count: s.count + 1 }) }
    });
    expect(store.get(counterModel)).toEqual({ count: 0 });
  });

  it('should update state using actions from a model-like atom', async () => {
    const counterModel = atom({
      build: () => ({ count: 0 }),
      actions: {
        inc: (s) => ({ count: s.count + 1 }),
        add: (s, amount: number) => ({ count: s.count + amount }),
      }
    });
    const actions = store.use(counterModel); // Use the atom directly
    expect(store.get(counterModel)).toEqual({ count: 0 });
    await actions.inc();
    expect(store.get(counterModel)).toEqual({ count: 1 });
    await actions.add(5);
    expect(store.get(counterModel)).toEqual({ count: 6 });
  });

  it('should handle async actions in model-like atoms', async () => {
    const userModel = atom({
      build: () => ({ loading: false, data: null as string | null, error: null as Error | null }),
      actions: {
        fetchUser: async (_state, userId: string) => {
          (store as any).internalSetState(userModel, { loading: true, data: null, error: null }); // Pass atom
          await tick();
          try {
            if (userId === 'error') throw new Error('Fetch failed');
            return { loading: false, data: `User data for ${userId}`, error: null };
          } catch (err) {
            return { loading: false, data: null, error: err as Error };
          }
        }
      }
    });
    const actions = store.use(userModel); // Use the atom directly
    const listener = vi.fn();
    store.on(userModel as Atom<any>, listener); // Cast to any
    expect(store.get(userModel)).toEqual({ loading: false, data: null, error: null });
    expect(listener).toHaveBeenCalledTimes(1);
    const fetchPromise = actions.fetchUser('123');
    expect(store.get(userModel)).toEqual({ loading: true, data: null, error: null });
    expect(listener).toHaveBeenCalledTimes(2);
    await fetchPromise;
    expect(store.get(userModel)).toEqual({ loading: false, data: 'User data for 123', error: null });
    expect(listener).toHaveBeenCalledTimes(3);
    const fetchErrorPromise = actions.fetchUser('error');
    expect(store.get(userModel)).toEqual({ loading: true, data: null, error: null });
    expect(listener).toHaveBeenCalledTimes(4);
    await fetchErrorPromise;
    const errorState = store.get(userModel);
    expect(errorState.loading).toBe(false);
    expect(errorState.data).toBeNull();
    expect(errorState.error).toBeInstanceOf(Error);
    expect((errorState.error as Error).message).toBe('Fetch failed');
    expect(listener).toHaveBeenCalledTimes(5);
  });

   it('should subscribe to state changes triggered by model actions', async () => {
    const counterModel = atom({
      build: () => ({ count: 0 }),
      actions: { inc: (s) => ({ count: s.count + 1 }) }
    });
    const actions = store.use(counterModel); // Use atom
    const listener = vi.fn();
    const unsubscribe = store.on(counterModel as Atom<any>, listener); // Cast to any
    expect(listener).toHaveBeenCalledTimes(1);
    await actions.inc();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ count: 1 }, undefined);
    await actions.inc();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith({ count: 2 }, undefined);
    unsubscribe();
    await actions.inc();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('should throw error when trying to set a model-like atom directly', () => {
    const modelAtom = atom({
      build: () => ({ value: 1 }),
      actions: { doSomething: s => s }
    });
    expect(() => store.set(modelAtom, { value: 2 })).toThrow('Cannot set model-like atom directly');
  });

  // --- Stream Atom Tests (Using AsyncIterable) ---

  async function* mockAsyncIterable<T>(values: T[], delay = 1, errorAfter?: number, complete = true) {
    // ... (implementation unchanged) ...
    let count = 0;
    for (const value of values) {
      await new Promise(res => setTimeout(res, delay));
      yield value;
      count++;
      if (errorAfter !== undefined && count >= errorAfter) {
        throw new Error(`AsyncIterable failed after ${count} items`);
      }
    }
    if (!complete) await new Promise(() => {});
  }

  it('should handle AsyncIterable stream atoms', async () => {
    const streamAtom = atom((ctx: AtomContext) => mockAsyncIterable([10, 20, 30], 1)); // Returns Atom
    const listener = vi.fn();
    store.on(streamAtom as Atom<any>, listener); // Cast to any
    expect(listener).toHaveBeenCalledTimes(1); // Initial pending
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(10, undefined));
    expect(store.get(streamAtom)).toBe(10);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(20, undefined));
    expect(store.get(streamAtom)).toBe(20);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(30, undefined));
    expect(store.get(streamAtom)).toBe(30);
  });

  it('should handle errors from AsyncIterable stream atoms', async () => {
    const streamAtom = atom((ctx: AtomContext) => mockAsyncIterable([1, 2], 1, 2)); // Returns Atom
    const listener = vi.fn();
    store.on(streamAtom as Atom<any>, listener); // Cast to any
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(1, undefined));
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(2, undefined));
    await vi.waitFor(() => {
        const lastCall = listener.mock.calls.find(call => call[1] instanceof Error);
        expect(lastCall).toBeDefined();
        expect((lastCall?.[1] as Error).message).toBe('AsyncIterable failed after 2 items');
    });
    expect(() => store.get(streamAtom)).toThrow('AsyncIterable failed after 2 items');
  });

  it('should teardown AsyncIterable when last subscriber unsubscribes', async () => {
      const sourceIterable = mockAsyncIterable([1, 2, 3, 4, 5], 1, undefined, false);
      const streamAtom = atom((ctx: AtomContext) => sourceIterable); // Returns Atom
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const storeInternal = store as any;
      const getInstance = (a: Atom<any>) => storeInternal.resolveAtomInstance(a);


      const unsub1 = store.on(streamAtom as Atom<any>, listener1); // Cast to any
      const unsub2 = store.on(streamAtom as Atom<any>, listener2); // Cast to any
      const instance = getInstance(streamAtom as Atom<any>); // Cast needed for helper

      await vi.waitFor(() => expect(listener1).toHaveBeenLastCalledWith(1, undefined));
      expect(listener2).toHaveBeenLastCalledWith(1, undefined);

      unsub1();

      await vi.waitFor(() => expect(listener2).toHaveBeenLastCalledWith(2, undefined));
      expect(listener1).toHaveBeenCalledTimes(2); // Initial + value 1

      unsub2(); // Last unsubscribe

      await tick(); // Give time for potential teardown

      expect(storeInternal.atomCache.has(instance._id)).toBe(false); // Check cache removal
  });

  // --- Dependency Tracking and Invalidation Tests ---

  it('should correctly track complex dependencies', () => {
    const a = atom(1);
    const b = atom(get => get(a) + 1); // Returns Atom
    const c = atom(get => get(a) + 10); // Returns Atom
    const d = atom(get => get(b) + get(c)); // Returns Atom
    const storeInternal = store as any;
    const getInstance = (a: Atom<any>) => storeInternal.resolveAtomInstance(a);

    expect(store.get(d)).toBe(13);

    const instanceA = getInstance(a);
    const instanceB = getInstance(b as Atom<any>); // Cast needed for helper
    const instanceC = getInstance(c as Atom<any>); // Cast needed for helper
    const instanceD = getInstance(d as Atom<any>); // Cast needed for helper

    expect(instanceA._dependents.has(instanceB)).toBe(true);
    expect(instanceA._dependents.has(instanceC)).toBe(true);
    expect(instanceB._dependents.has(instanceD)).toBe(true);
    expect(instanceC._dependents.has(instanceD)).toBe(true);
    expect(instanceD._dependencies.has(instanceB)).toBe(true);
    expect(instanceD._dependencies.has(instanceC)).toBe(true);
    expect(instanceB._dependencies.has(instanceA)).toBe(true);
    expect(instanceC._dependencies.has(instanceA)).toBe(true);
  });

  it('should invalidate dependents correctly when a dependency changes', () => {
    const a = atom(1);
    const b = atom(get => get(a) + 1);
    const c = atom(get => get(a) + 10);
    const d = atom(get => get(b) + get(c));
    const storeInternal = store as any;
    const getInstance = (a: Atom<any>) => storeInternal.resolveAtomInstance(a);

    store.get(d);
    const instanceA = getInstance(a);
    const instanceB = getInstance(b as Atom<any>); // Cast needed for helper
    const instanceC = getInstance(c as Atom<any>); // Cast needed for helper
    const instanceD = getInstance(d as Atom<any>); // Cast needed for helper

    store.set(a, 2);

    expect(instanceA._state).toBe('valid');
    expect(instanceB._state).toBe('dirty');
    expect(instanceC._state).toBe('dirty');
    expect(instanceD._state).toBe('dirty');

    expect(store.get(d)).toBe(15);

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
      const getState = (atm: Atom<any> | FamilyMemberAtomDescriptor<any>) => storeInternal.resolveAtomInstance(atm as Atom<any> | FamilyMemberAtomDescriptor<any>)._state;

      store.get(d);
      expect(getState(a)).toBe('valid'); expect(getState(b as Atom<any>)).toBe('valid'); expect(getState(c as Atom<any>)).toBe('valid'); expect(getState(d as Atom<any>)).toBe('valid');

      store.get(d);
      expect(getState(a)).toBe('valid'); expect(getState(b as Atom<any>)).toBe('valid'); expect(getState(c as Atom<any>)).toBe('valid'); expect(getState(d as Atom<any>)).toBe('valid');

      store.set(a, 2);
      expect(getState(a)).toBe('valid'); expect(getState(b as Atom<any>)).toBe('dirty'); expect(getState(c as Atom<any>)).toBe('dirty'); expect(getState(d as Atom<any>)).toBe('dirty');

      store.get(b);
      expect(getState(a)).toBe('valid'); expect(getState(b as Atom<any>)).toBe('valid'); expect(getState(c as Atom<any>)).toBe('dirty'); expect(getState(d as Atom<any>)).toBe('dirty');

      store.get(d);
      expect(getState(a)).toBe('valid'); expect(getState(b as Atom<any>)).toBe('valid'); expect(getState(c as Atom<any>)).toBe('valid'); expect(getState(d as Atom<any>)).toBe('valid');
  });

  it('should handle dynamic dependencies', () => {
      const switchAtom = atom(true);
      const atomA = atom(10);
      const atomB = atom(20);
      const conditionalAtom = atom(get => { // Returns Atom
          return get(switchAtom) ? get(atomA) : get(atomB);
      });
      const storeInternal = store as any;
      const getInstance = <T>(a: Atom<T>) => storeInternal.resolveAtomInstance(a as Atom<any>);

      expect(store.get(conditionalAtom)).toBe(10);
      const instanceConditional = getInstance(conditionalAtom as Atom<any>); // Cast needed
      const instanceA = getInstance(atomA);
      const instanceB = getInstance(atomB);
      const instanceSwitch = getInstance(switchAtom);

      expect(instanceConditional._dependencies.has(instanceSwitch)).toBe(true);
      expect(instanceConditional._dependencies.has(instanceA)).toBe(true);
      expect(instanceConditional._dependencies.has(instanceB)).toBe(false);

      store.set(atomB, 25);
      expect(instanceConditional._state).toBe('valid');
      expect(store.get(conditionalAtom)).toBe(10);

      store.set(switchAtom, false);
      expect(instanceConditional._state).toBe('dirty');

      expect(store.get(conditionalAtom)).toBe(25);
      expect(instanceConditional._state).toBe('valid');
      expect(instanceConditional._dependencies.has(instanceSwitch)).toBe(true);
      expect(instanceConditional._dependencies.has(instanceA)).toBe(false);
      expect(instanceConditional._dependencies.has(instanceB)).toBe(true);

      store.set(atomA, 15);
      expect(instanceConditional._state).toBe('valid');
      expect(store.get(conditionalAtom)).toBe(25);
  });

  // --- Teardown Tests ---

  it('should teardown atom when last subscriber unsubscribes', () => {
    const countAtom = atom(0); // Returns Atom
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const storeInternal = store as any;
    const getInstance = <T>(a: Atom<T>) => storeInternal.resolveAtomInstance(a as Atom<any>);

    store.get(countAtom);
    const instance = getInstance(countAtom);
    expect(storeInternal.atomCache.has(instance._id)).toBe(true);

    const unsubscribe1 = store.on(countAtom as Atom<any>, listener1); // Cast to any
    const unsubscribe2 = store.on(countAtom as Atom<any>, listener2); // Cast to any
    expect(instance._subscribers.size).toBe(2);

    unsubscribe1();
    expect(instance._subscribers.size).toBe(1);
    expect(storeInternal.atomCache.has(instance._id)).toBe(true);

    unsubscribe2();
    expect(storeInternal.atomCache.has(instance._id)).toBe(false);

    const listener3 = vi.fn();
    store.on(countAtom as Atom<any>, listener3); // Cast to any
    const newInstance = getInstance(countAtom);
    expect(storeInternal.atomCache.has(newInstance._id)).toBe(true);
    expect(listener3).toHaveBeenCalledTimes(1);
  });

  // --- Error Handling in Computed ---

  it('should allow computed atoms to catch and handle dependency errors via try-catch', () => {
    const errorSourceAtom = atom((ctx: AtomContext) => { // Returns Atom
      throw new Error('Dependency Failed');
    });

    const errorHandlerAtom = atom(get => { // Returns Atom
      try {
        get(errorSourceAtom);
        return 'Dependency OK';
      } catch (e) {
        return 'Handled Error: ' + (e as Error).message;
      }
    });

    expect(store.get(errorHandlerAtom)).toBe('Handled Error: Dependency Failed');
    expect(() => store.get(errorSourceAtom)).toThrow('Dependency Failed');
  });

  // --- Circular Dependencies ---

  it('should detect simple direct circular dependencies', () => {
    let a: Atom<number>;
    let b: Atom<number>;
    // Use context form which returns Atom
    a = atom((ctx: AtomContext) => ctx.get(b) + 1);
    b = atom((ctx: AtomContext) => ctx.get(a) + 1);

    expect(() => store.get(a)).toThrow(/Circular dependency detected/);
    store = new Store();
    expect(() => store.get(b)).toThrow(/Circular dependency detected/);
  });

  it('should detect indirect circular dependencies', () => {
    let a: Atom<number>;
    let b: Atom<number>;
    let c: Atom<number>;
    a = atom((ctx: AtomContext) => ctx.get(c) + 1);
    b = atom((ctx: AtomContext) => ctx.get(a) + 1);
    c = atom((ctx: AtomContext) => ctx.get(b) + 1);

    expect(() => store.get(a)).toThrow(/Circular dependency detected/);
    store = new Store();
    expect(() => store.get(b)).toThrow(/Circular dependency detected/);
    store = new Store();
    expect(() => store.get(c)).toThrow(/Circular dependency detected/);
  });

   it('should allow accessing an atom within its own writable computed setter', () => {
    const countAtom = atom(0);
    const writableAtom = atom<number>({ // Returns Atom
      get: (get) => get(countAtom),
      set: ({ get, set }, newValue) => {
        // Get the current value *before* the set operation
        // Note: Inside the setter, `get(writableAtom)` would cause infinite recursion.
        // We need to get the dependency's value directly.
        const currentCount = get(countAtom);
        // newValue is guaranteed to be number here because the atom type is number
        // Add type assertions for comparison and set
        if ((newValue as number) > currentCount) {
          set(countAtom, newValue as number);
        }
      }
    });

    expect(store.get(writableAtom)).toBe(0);
    store.set(writableAtom, 5);
    expect(store.get(countAtom)).toBe(5);
    expect(store.get(writableAtom)).toBe(5);

    store.set(writableAtom, 3);
    expect(store.get(countAtom)).toBe(5);
    expect(store.get(writableAtom)).toBe(5);

     store.set(writableAtom, 10);
    expect(store.get(countAtom)).toBe(10);
    expect(store.get(writableAtom)).toBe(10);
  });

}); // Close outer describe block
