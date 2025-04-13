# Active Context

**Current Focus**: Fixing failing unit tests in `src/store.spec.ts`.
**Summary of Recent Actions**:
- Added comprehensive unit tests for atom families, model-like atoms, streams, dependency tracking, and circular dependencies to `src/store.spec.ts`.
- Made multiple attempts to fix type errors and logic issues in `src/atom.ts`, `src/types.ts`, and `src/store.ts` based on test failures.
- **Current State**: `npm test` reports 11 failing tests and 1 unhandled rejection related to async family error handling. Issues seem related to async/stream handling, model action state updates, dynamic dependency tracking, circular dependency detection, and family teardown logic.

**Previous Context (Pre-Test Fixing)**:
- **Fixed Heap Overflow**: Resolved recursive loop in `store.ts`'s `propagateChanges`.
- **Added `.gitignore`**: Created standard `.gitignore`.
- **Refined Error Handling (Phase 1)**: Modified internal `getter` in `buildAtom` to allow computed atoms to catch dependency errors.

**Next Steps**:
1.  **Fix Failing Unit Tests**: Systematically address the 11 failing tests and 1 unhandled error reported by `npm test`. Focus areas:
    - Async family promise resolution (`store.get` returning Promise).
    - Model action state updates (`internalSetState`, `use` method).
    - Stream handling (initial notification, error propagation).
    - Dynamic dependency updates (`clearDependencies`, `registerDependency`).
    - Circular dependency detection logic (`buildAtom`, `getter`).
    - Family teardown logic (`maybeTeardownAtom`, cache interaction).
2.  Implement React hooks (optional).
3.  Documentation (including README).