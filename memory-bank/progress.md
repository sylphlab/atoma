# Progress

**Current Status**: Encountered JavaScript heap out of memory error during unit tests after implementing several new features and modifying `store.on` behavior. Debugging is required.

**What Works (Potentially Unstable)**:
- Project setup with tsup and Vitest.
- Core file structure and types (including `AtomFamilyTemplate`, `WritableComputedAtomDefinition`, `AtomState`).
- `atom()` and `atomFamily()` functions defined.
- `Store` class implementation for `get`, `set`, `on`, `use`, `resolve...Instance`, `buildAtom`, `updateAtomState`, `invalidateAtom`, `propagateChanges`, `maybeTeardownAtom`.
- Dependency tracking and circular dependency detection (basic).
- Code compiles successfully.
- Refined Teardown logic implemented (includes cache removal).
- Writable Computed Atoms basic support implemented.
- Refined Dirty Checking implemented using `AtomState`.
- Unit tests added for Teardown, Writable Computed Atoms, and State Transitions.

**What's Left / Next Steps**:
- **CRITICAL**: Debug and fix the JavaScript heap out of memory error occurring during `npm test`. Analyze the interaction between `store.on` (immediate notification), `buildAtom`, `updateAtomState`, `notifySubscribers`, and `propagateChanges`.
- Implement remaining `Store` logic:
    - **Refined Error Propagation**: Improve how errors are handled and potentially stored/cleared.
- Write/Fix comprehensive unit tests for all features (families, models, streams, writable computed, teardown, dirty checking/state transitions, edge cases) *after* fixing the heap issue.
- Implement React hooks (optional).
- Documentation.

**Known Issues**:
- **Heap out of memory error during `npm test`**, likely due to an infinite loop or memory leak related to recent changes in notification/state management logic.
- Stream/Iterable handling in `buildAtom` is basic and needs refinement/testing.
- Teardown logic's async cancellation is still basic.
- Error handling/propagation could be more sophisticated.
- Comprehensive testing is incomplete and blocked by the heap issue.