# Progress

**Current Status**: Unit tests are passing after fixing the heap overflow issue and implementing the first phase of refined error handling (allowing computed atoms to catch dependency errors). Added `.gitignore`. The focus is now on writing comprehensive unit tests.
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
- Unit tests added for Teardown, Writable Computed Atoms, State Transitions, and basic Error Handling (computed catching dependency error).

**What's Left / Next Steps**:
- **Write/Fix comprehensive unit tests**: Cover all features (families, models, streams, writable computed, teardown, dirty checking/state transitions, error propagation, edge cases). This is the current priority.
- Implement React hooks (optional).
- Documentation.

**Known Issues**:
- Stream/Iterable handling in `buildAtom` is basic and needs refinement/testing.
- Teardown logic's async cancellation is still basic.
- Error handling/propagation could be more sophisticated (further refinements might be needed after testing).
- Comprehensive testing is incomplete.