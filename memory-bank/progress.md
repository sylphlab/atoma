# Progress

**Current Status**: Added comprehensive unit tests covering families, models, streams, dependencies, and circular dependencies. However, running `npm test` reveals 11 failing tests and 1 unhandled error. The core logic seems functional for basic cases, but edge cases, async operations, streams, and complex interactions require debugging.
**What Works (Potentially Unstable)**:
- Project setup with tsup and Vitest.
- Core file structure and types.
- `atom()` and `atomFamily()` functions defined.
- `Store` class implementation (basic functionality).
- Basic dependency tracking.
- Basic Teardown logic.
- Basic Writable Computed Atoms.
- Basic State Transitions / Dirty Checking.
- Some unit tests pass (static atoms, basic computed, basic async, basic error handling).

**What's Left / Next Steps**:
1.  **Fix Failing Unit Tests (Priority)**: Address the 11 failing tests and 1 unhandled error in `src/store.spec.ts`. See `activeContext.md` for specific areas.
2.  Implement React hooks (optional).
3.  Documentation (including README).

**Known Issues**:
- **Test Failures**: 11 tests failing related to async families, model actions, streams, dynamic dependencies, circular dependencies, and family teardown.
- **Unhandled Rejection**: Error in async family test (`Error: Invalid ID`) is not being caught correctly by the test or the store logic.
- Stream/Iterable handling in `buildAtom` needs review (error propagation, initial state).
- Teardown logic needs review (family instances, async cancellation).
- Dynamic dependency tracking needs review.
- Circular dependency detection needs review.
- Model action state update/notification logic needs review.