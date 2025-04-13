# Active Context

**Current Focus**: Implementing remaining core `Store` features.

**Summary of Recent Actions**:
- **Refactored Atom Families & Fixed Tests**:
    - Introduced explicit `atomFamily()` function.
    - Removed implicit family detection from `atom()`.
    - Updated types (`AtomFamilyTemplate`, guards).
    - Updated `Store` logic (`resolveAtomInstance`, `resolveFamilyInstance`, `buildAtom` argument passing).
    - Updated exports.
    - Fixed all resulting TypeScript errors.
    - Modified `store.spec.ts` to expect initial notification on subscription.
    - **Successfully ran `npm test` - all 8 tests passed.**
- Renamed project references to `@atoma/core`.

**Current Problem**: Core functionality is working, but several features outlined in `progress.md` are still basic or missing (e.g., refined teardown, writable computed atoms).

**Next Steps**:
1. Implement refined teardown logic in `Store.maybeTeardownAtom` (including cache removal).
2. Implement writable computed atoms.
3. Implement refined dirty checking.
4. Implement refined error propagation.
5. Write more comprehensive unit tests covering new features and edge cases.