# Active Context

**Current Focus**: Writing comprehensive unit tests for all features.
**Summary of Recent Actions**:
- **Fixed Heap Overflow**: Resolved recursive loop in `store.ts`'s `propagateChanges`. Tests pass.
- **Added `.gitignore`**: Created standard `.gitignore`.
- **Refined Error Handling (Phase 1)**: Modified internal `getter` in `buildAtom` to return errors instead of throwing, allowing computed atoms to catch dependency errors. Updated `Getter` type. Added test case (`should allow computed atoms to catch and handle dependency errors`). All tests pass.
**Previous Context (Pre-Fix)**:
- Refactored Atom Families & Fixed Initial Tests.
- Renamed project references to `@atoma/core`.
- Implemented refined teardown logic.
- Implemented basic support for Writable Computed Atoms.
- Implemented Refined Dirty Checking.
- Added unit tests for new features.
- Modified `store.on` for immediate notification.
- Encountered heap overflow during tests.

**Next Steps**:
1.  **Write/Fix Comprehensive Unit Tests**: Cover all features (families, models, streams, writable computed, teardown, dirty checking/state transitions, error propagation, edge cases). This is the current focus.
2.  Implement React hooks (optional).
3.  Documentation.