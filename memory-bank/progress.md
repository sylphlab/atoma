# Progress

**Current Status**: Attempting to refactor atom family API to use `atom((ctx, params...) => initializer)` returning an invoker (`familyInvoker(params)`). This refactoring is **incomplete and has introduced numerous TypeScript errors**, primarily due to `atom()` overloads incorrectly inferring non-family atoms as `FamilyInvoker`. The original 4 failing unit tests are currently masked by these type errors.
**What Works (Potentially Unstable)**:
- Project setup with tsup and Vitest.
- Core file structure and types.
- `atom()` function definition updated to return `FamilyInvoker` for parameterized initializers (CURRENTLY CAUSING TYPE ERRORS).
- `Store` class implementation (most functionality).
- Basic dependency tracking.
- Teardown logic (basic atoms, streams). Family teardown needs verification after API refactor.
- Writable Computed Atoms (non-family). Writable computed families need verification after API refactor.
- Basic State Transitions / Dirty Checking.
- Model-like atoms (state updates, async actions, notifications).
- Stream handling (Observable/AsyncIterable initial calls, basic values, completion, teardown).
- Async atom value resolution and basic error handling (non-family). Family async needs verification.
- **Unit tests are currently broken due to widespread TypeScript errors introduced by the API refactoring.**

**What's Left / Next Steps**:
1.  **Fix `atom.ts` Overloads & Implementation (Highest Priority)**: Resolve the type inference issues causing non-family atoms to be treated as `FamilyInvoker`. Ensure `atom()` correctly returns `Atom` or `FamilyInvoker` based on the initializer signature.
2.  **Fix `src/store.spec.ts`**: Update all tests to use the new family API (`familyInvoker(params)`) and resolve all resulting TypeScript errors.
3.  **Fix Store Method Type Compatibility**: Ensure `store.ts` methods handle `Atom | FamilyMemberAtomDescriptor` correctly and resolve type mismatches.
4.  **Fix Original Unit Tests**: Once type errors are resolved, address the original 4 failing tests (dynamic dependencies, circular dependencies).
5.  Implement React hooks (optional).
6.  Review and finalize documentation (README).

**Known Issues**:
- **Widespread TypeScript Errors**: Numerous errors in `src/store.spec.ts` due to incorrect type inference from `atom()` overloads and incorrect usage of the new (partially implemented) family API.
- **Original Test Failures (4 - Masked)**: Likely still present but hidden by type errors. Related to dynamic dependencies and circular dependency detection.
- **API Instability**: The current family API implementation (`atom` returning `FamilyInvoker`, store methods accepting descriptors) is causing type conflicts and needs significant refinement or rethinking.