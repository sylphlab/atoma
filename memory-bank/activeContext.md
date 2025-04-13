# Active Context

**Current Focus**: Refactoring atom family API to use `atom((ctx, params...) => initializer)` returning an invoker (`familyInvoker(params)`), and fixing resulting TypeScript errors.
**Summary of Recent Actions**:
- Added comprehensive unit tests for atom families, model-like atoms, streams, dependency tracking, and circular dependencies to `src/store.spec.ts`.
- Made multiple attempts to fix type errors and logic issues in `src/atom.ts`, `src/types.ts`, and `src/store.ts` based on test failures.
- **Fixed Model Action Tests**: Modified `src/store.spec.ts` to `await` action calls, resolving issues with state updates and notifications.
- **Fixed Stream Initial Call Tests**: Modified `buildAtom` in `src/store.ts` to notify subscribers immediately when stream state becomes 'pending'.
- **Fixed Family Teardown Test**: Corrected property access from `subs.size` to `_subscribers.size` in `src/store.spec.ts`.
- **Fixed Async Family Value Test**: Modified `store.get` logic and added `await tick()` in the test to handle promise resolution timing.
- **Fixed AsyncIterable Error Test**: Modified test to use `vi.waitFor` to ensure error state is set before assertion.
- **Refactored Family API (Attempt 3)**:
    - Modified `src/types.ts` to define `FamilyInvoker` and `FamilyMemberAtomDescriptor`.
    - Modified `src/atom.ts` overloads and implementation to return `FamilyInvoker` for initializers with context + params (`(ctx, ...params) => init`).
    - Modified `src/store.ts` methods (`get`, `on`, `set`, `use`) to accept `Atom | FamilyMemberAtomDescriptor` and resolve instances internally.
    - Updated `src/store.spec.ts` to use the new API (`familyInvoker(param)`).
- **Current State**: Refactoring introduced numerous TypeScript errors in `src/store.spec.ts`. The core issue seems to be the `atom.ts` overloads still incorrectly inferring non-family computed atoms (e.g., `atom(get => ...)`) as `FamilyInvoker`. Store methods also show type mismatches when receiving atoms vs. descriptors. The original 4 failing unit tests are likely still present but masked by these new type errors.

**Previous Context (Pre-Test Fixing)**:
- **Fixed Heap Overflow**: Resolved recursive loop in `store.ts`'s `propagateChanges`.
- **Added `.gitignore`**: Created standard `.gitignore`.
- **Refined Error Handling (Phase 1)**: Modified internal `getter` in `buildAtom` to allow computed atoms to catch dependency errors.

**Next Steps**:
1.  **Fix `atom.ts` Overloads**: Resolve the ambiguity between family initializers (`(ctx, p) => init`) and non-family computed initializers (`(get) => val`, `(ctx) => val`) so that `atom()` returns the correct type (`Atom` or `FamilyInvoker`).
2.  **Fix `src/store.spec.ts` Type Errors**: Ensure tests correctly use the `familyInvoker(param)` syntax for families and that non-family atoms are correctly typed as `Atom`. Address any remaining type errors after fixing `atom.ts`.
3.  **Address Store Method Type Mismatches**: Review `store.ts` methods (`get`, `on`, `set`, `use`) and potentially `src/types.ts` to resolve `Atom<T>` vs `Atom<T | Promise<T> | AsyncIterable<T>>` mismatches if they persist after fixing overloads.
4.  **Fix Original Unit Tests**: Once type errors are resolved, address the original 4 failing unit tests related to dynamic dependencies and circular dependency detection.
2.  Implement React hooks (optional).
3.  Documentation (including README).