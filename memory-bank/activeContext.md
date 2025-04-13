# Active Context

**Current Focus**: Fixing remaining failing unit tests in `src/store.spec.ts`.
**Summary of Recent Actions**:
- Added comprehensive unit tests for atom families, model-like atoms, streams, dependency tracking, and circular dependencies to `src/store.spec.ts`.
- Made multiple attempts to fix type errors and logic issues in `src/atom.ts`, `src/types.ts`, and `src/store.ts` based on test failures.
- **Fixed Model Action Tests**: Modified `src/store.spec.ts` to `await` action calls, resolving issues with state updates and notifications.
- **Fixed Stream Initial Call Tests**: Modified `buildAtom` in `src/store.ts` to notify subscribers immediately when stream state becomes 'pending'.
- **Fixed Family Teardown Test**: Corrected property access from `subs.size` to `_subscribers.size` in `src/store.spec.ts`.
- **Fixed Async Family Value Test**: Modified `store.get` logic and added `await tick()` in the test to handle promise resolution timing.
- **Fixed AsyncIterable Error Test**: Modified test to use `vi.waitFor` to ensure error state is set before assertion.
- **Current State**: `npm test` reports 4 failing tests. Issues seem related to dynamic dependency tracking and circular dependency detection logic/error messages.

**Previous Context (Pre-Test Fixing)**:
- **Fixed Heap Overflow**: Resolved recursive loop in `store.ts`'s `propagateChanges`.
- **Added `.gitignore`**: Created standard `.gitignore`.
- **Refined Error Handling (Phase 1)**: Modified internal `getter` in `buildAtom` to allow computed atoms to catch dependency errors.

**Next Steps**:
1.  **Fix Remaining Unit Tests**: Systematically address the 4 failing tests reported by `npm test`. Focus areas:
    - Dynamic dependency updates (`clearDependencies`, `registerDependency`).
    - Circular dependency detection logic (`buildAtom`, `getter`) and error messages.
2.  Implement React hooks (optional).
3.  Documentation (including README).