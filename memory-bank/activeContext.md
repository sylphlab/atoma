# Active Context

**Current Focus**: Debugging JavaScript heap out of memory error during unit tests.

**Summary of Recent Actions**:
- **Refactored Atom Families & Fixed Initial Tests**:
    - Introduced explicit `atomFamily()` function.
    - Removed implicit family detection from `atom()`.
    - Updated types (`AtomFamilyTemplate`, guards).
    - Updated `Store` logic (`resolveAtomInstance`, `resolveFamilyInstance`, `buildAtom` argument passing).
    - Updated exports.
    - Fixed all resulting TypeScript errors.
    - Modified `store.spec.ts` to expect initial notification on subscription.
    - Successfully ran initial 8 tests.
- Renamed project references to `@atoma/core`.
- Implemented refined teardown logic (`maybeTeardownAtom` with cache removal).
- Implemented basic support for Writable Computed Atoms (`WritableComputedAtomDefinition`, updated `store.set`, updated `buildAtom`).
- Implemented Refined Dirty Checking:
    - Added `AtomState` type (`idle`, `building`, `valid`, `error`, `pending`, `dirty`) to `Atom` interface.
    - Updated `Store` methods (`resolve...Instance`, `buildAtom`, `updateAtomState`, `invalidateAtom`, `get`, `set`) to manage and utilize `_state`.
- Added unit tests for Teardown, Writable Computed Atoms, and State Transitions in `store.spec.ts`.
- Modified `store.on` to immediately notify new subscribers with the current atom state if available.
- **Ran `npm test`**: Tests failed with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.

**Current Problem**: The latest changes, particularly the immediate notification logic in `store.on`, seem to have introduced an infinite loop or memory leak, causing tests to run out of memory. This likely stems from the interaction between `on` calling the callback, which might trigger `get`, leading back to `buildAtom`, `updateAtomState`, `notifySubscribers`, and potentially `propagateChanges`, creating a cycle under certain conditions.

**Next Steps (for next AI)**:
1. **Debug Heap Overflow**: Analyze the interaction flow starting from `store.on`'s immediate notification. Specifically examine:
    - `on` -> `callback` (immediate call)
    - `callback` potentially calling `store.get`
    - `store.get` potentially calling `buildAtom` (if state is 'idle' or 'dirty')
    - `buildAtom` calling `updateAtomState`
    - `updateAtomState` calling `notifySubscribers` and `propagateChanges`
    - `propagateChanges` calling `invalidateAtom` (setting state to 'dirty') and potentially `buildAtom` again if subscribed.
    Identify the recursive loop or excessive object creation causing the memory exhaustion.
2. Fix the identified issue in `store.ts`.
3. Rerun tests (`npm test`) to confirm the fix.
4. Proceed with remaining tasks (error propagation, more tests) once the heap issue is resolved.