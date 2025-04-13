# Progress

**Current Status**: Unit tests are passing after fixing the heap overflow issue. The focus is now on implementing refined error propagation. Added `.gitignore`.
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
- Implement remaining `Store` logic:
    - **Refined Error Propagation**: Improve how errors are handled and potentially stored/cleared within atoms and propagated to subscribers/dependents.
- Write/Fix comprehensive unit tests for all features (families, models, streams, writable computed, teardown, dirty checking/state transitions, error propagation, edge cases).
- Implement React hooks (optional).
- Documentation.

**Known Issues**:
- Stream/Iterable handling in `buildAtom` is basic and needs refinement/testing.
- Teardown logic's async cancellation is still basic.
- Error handling/propagation could be more sophisticated (currently being addressed).
- Comprehensive testing is incomplete.