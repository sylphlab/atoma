# System Patterns

## State Management Library Design (`@atoma/core` - Final)

**Core Concepts**:
- **`atom(initialValue | ((get) => value) | { build, actions } | (param) => ...)`**: The single function to create all state units.
    - **Sync**: `atom(value)`
    - **Computed**: `atom(get => ...)`
    - **Async**: `atom(async get => ...)` or `atom(async () => ...)`
    - **Stream**: `atom(() => Observable)`
    - **Model-like (State+Actions)**: `atom({ build: () => initialState, actions: { ... } })`
    - **Family (Parameterized)**: `atom((param) => ...)` - Automatically detected if the initializer function takes parameters.
- **`store()`**: Creates an isolated container instance.
- **`store.get(atom)`**: Retrieves the current value. Handles sync/async/stream transparently *internally*. For async/stream, the initial call might trigger the operation but the return value semantics depend on the environment (e.g., UI hooks handle pending/error states, direct calls might return undefined or throw Suspense-like errors until ready).
- **`store.set(atom, newValue | (prev) => newValue)`**: Updates a writable atom's value (basic atoms or those without explicit actions).
- **`store.on(atom, callback)`**: Subscribes to state changes (value emissions for sync/async/stream).
- **`store.use(atom)`**: Retrieves the `actions` object if the atom was defined with one (model-like atoms).

**Key Design Goals**:
- Framework-agnostic.
- Extremely minimal and unified API surface (`atom`, `store`).
- Transparent handling of sync, async, computed, stream, and model-like states.
- Implicit families for simplicity.
- Clear separation of state retrieval (`get`) and action dispatching (`use`).

**Example Usage Pattern**:
```typescript
// Define state
const count = atom({ build: () => 0, actions: { inc: s => s + 1 } });
const name = atom('World');
const message = atom(get => `Hello, ${get(name)}! Count: ${get(count)}`);
const user = atom(async (id: string) => fetch(`/api/users/${id}`).then(r=>r.json())); // Family

// Use in a store
const app = store();
const counterApi = app.use(count);
const user1 = user('1'); // Get specific family instance

console.log(app.get(message)); // Hello, World! Count: 0
counterApi.inc();
console.log(app.get(message)); // Hello, World! Count: 1
app.set(name, 'AtomaState');
console.log(app.get(message)); // Hello, AtomaState! Count: 1

// Async/Family access (conceptual - UI hooks handle loading state)
try { console.log(app.get(user1)); } catch(e) { console.log('User 1 loading...'); }
```