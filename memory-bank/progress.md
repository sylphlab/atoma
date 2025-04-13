# Progress

**Current Status**: Core functionality refactored (explicit `atomFamily`) and initial unit tests are passing. Ready to implement remaining core features.

**What Works**:
- Project setup with tsup and Vitest.
- Core file structure and types (including `AtomFamilyTemplate`).
- `atom()` and `atomFamily()` functions defined and working correctly in tests.
- `Store` class with basic implementation for `get`, `set`, `on`, `use`, `resolveAtomInstance`, `resolveFamilyInstance`.
- `buildAtom` handles sync, async (Promise), Observable-like, and AsyncIterable (basic). Correctly passes arguments based on initializer arity.
- Dependency tracking and circular dependency detection (basic).
- Code compiles successfully.
- **All 8 initial unit tests in `store.spec.ts` pass.**

**What's Left / Next Steps**:
- Implement remaining `Store` logic:
    - **Refined Teardown**: Enhance `maybeTeardownAtom` to remove atoms from `atomCache` and `familyCache`. Handle async cancellation more robustly.
    - **Writable Computed Atoms**: Add support for atoms defined with a setter function alongside the getter. Update `store.set` logic.
    - **Refined Dirty Checking**: Implement more efficient checks than just `_value === undefined`.
    - **Refined Error Propagation**: Improve how errors are handled and potentially stored/cleared.
- Write comprehensive unit tests for all features (families, models, streams, writable computed, teardown, edge cases).
- Implement React hooks (optional).
- Documentation.

**Known Issues**:
- Stream/Iterable handling in `buildAtom` is basic and needs refinement/testing.
- Teardown logic is currently incomplete (doesn't remove from caches).
- Error handling/propagation could be more sophisticated.
- Missing comprehensive tests for many features.