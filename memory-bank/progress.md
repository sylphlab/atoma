# Progress

**Current Status**: Unit tests significantly improved. Running `npm test` now reveals 4 failing tests. Core logic, async handling, model actions, stream initial calls, and family teardown appear functional. Remaining issues are focused on dynamic dependencies and circular dependency detection.
**What Works (Potentially Unstable)**:
- Project setup with tsup and Vitest.
- Core file structure and types.
- `atom()` and `atomFamily()` functions defined.
- `Store` class implementation (most functionality).
- Basic dependency tracking.
- Teardown logic (basic atoms, families, streams).
- Writable Computed Atoms (including families).
- Basic State Transitions / Dirty Checking.
- Model-like atoms (state updates, async actions, notifications).
- Stream handling (Observable/AsyncIterable initial calls, basic values, completion, teardown).
- Async atom/family value resolution and basic error handling.
- Most unit tests pass.

**What's Left / Next Steps**:
1.  **Fix Remaining Unit Tests (Priority)**: Address the 4 failing tests in `src/store.spec.ts`. See `activeContext.md` for specific areas (dynamic dependencies, circular dependency detection/messages).
2.  Implement React hooks (optional).
3.  Documentation (including README).

**Known Issues**:
- **Test Failures (4)**:
    - Dynamic dependency tracking (`should handle dynamic dependencies`).
    - Circular dependency detection error messages (`should detect simple direct circular dependencies`, `should detect indirect circular dependencies`).
- Dynamic dependency update logic (`clearDependencies`, `registerDependency`) needs review.
- Circular dependency detection logic (`buildAtom`, `getter`) needs review, specifically the error message generation/propagation.