# Active Context

**Current Focus**: Implementing Refined Error Propagation in `Store`.

**Summary of Recent Actions**:
- **Fixed Heap Overflow**: Identified and fixed a recursive loop in `store.ts`'s `propagateChanges` function. The function was immediately rebuilding subscribed dependents after invalidation, leading to potential infinite loops. Changed the logic to only invalidate, relying on lazy evaluation (rebuild on next `get`).
- **Ran `npm test`**: Tests now pass successfully after the fix.
- **Added `.gitignore`**: Created a standard `.gitignore` file for Node.js/TypeScript projects.

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
1. Implement remaining `Store` logic:
    - **Refined Error Propagation**: Improve how errors are handled and potentially stored/cleared within atoms and propagated to subscribers/dependents.
2. Write/Fix comprehensive unit tests for all features (families, models, streams, writable computed, teardown, dirty checking/state transitions, error propagation, edge cases).
3. Implement React hooks (optional).
4. Documentation.