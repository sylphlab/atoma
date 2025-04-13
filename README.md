# @atoma/core

A minimalist, framework-agnostic state management library with a unified API for sync, async, computed, stream, model-like, and family states.

## Installation

```bash
npm install @atoma/core
# or
yarn add @atoma/core
# or
pnpm add @atoma/core
```

## Core Concepts & Syntax

`@atoma/core` revolves around two main functions: `atom()` for defining state units and `store()` for creating isolated state containers.

```typescript
import { atom, store } from '@atoma/core';

// --- Define Atoms ---

// 1. Simple Writable State
const count = atom(0);
const name = atom('World');

// 2. Computed/Derived State (Read-only by default)
const message = atom(get => `Hello, ${get(name)}! Count: ${get(count)}`);

// 3. Async State
const userData = atom(async () => {
  const response = await fetch('/api/user');
  if (!response.ok) throw new Error('Failed to fetch user');
  return await response.json();
});

// 4. Stream State (e.g., using Observables or AsyncIterables)
const timer = atom(() => {
  // Example using a simple async generator
  return (async function* () {
    let i = 0;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      yield i++;
    }
  })();
});

// 5. Model-like State (State + Actions)
const counterModel = atom({
  build: () => ({ value: 0 }), // Initial state builder
  actions: {
    increment: (state) => ({ value: state.value + 1 }),
    decrement: (state) => ({ value: state.value - 1 }),
    add: (state, amount: number) => ({ value: state.value + amount }),
  }
});

// 6. Atom Family (Parameterized State)
// Automatically detected if the initializer function takes parameters
const userById = atom(async (userId: string) => {
  const response = await fetch(`/api/users/${userId}`);
  if (!response.ok) throw new Error(`Failed to fetch user ${userId}`);
  return await response.json();
});

// --- Use in a Store ---

const appStore = store();

// Get state
console.log(appStore.get(message)); // Output: Hello, World! Count: 0

// Set writable state
appStore.set(count, 5);
console.log(appStore.get(message)); // Output: Hello, World! Count: 5
appStore.set(name, (prevName) => prevName.toUpperCase());
console.log(appStore.get(message)); // Output: Hello, WORLD! Count: 5

// Use model actions
const counterActions = appStore.use(counterModel);
counterActions.increment();
console.log(appStore.get(counterModel).value); // Output: 1
counterActions.add(10);
console.log(appStore.get(counterModel).value); // Output: 11

// Get family instance
const user1 = userById('1');
const user2 = userById('2');

// Subscribe to changes
const unsubscribe = appStore.on(message, (newMessage) => {
  console.log('Message changed:', newMessage);
});

appStore.set(count, 100); // Triggers subscription: "Message changed: Hello, WORLD! Count: 100"

unsubscribe(); // Stop listening

// Async/Stream access (Conceptual - UI integrations handle loading/error states)
try {
  console.log('User 1 Data:', appStore.get(user1)); // Might initially throw or return pending state
} catch (e) {
  console.error('Error fetching user 1:', e);
}
```

## Key Features

*   **Unified API**: A single `atom()` function creates all types of state (sync, async, computed, stream, model, family).
*   **Minimalist Surface**: Only `atom()` and `store()` are needed to get started.
*   **Framework-Agnostic**: Designed to work in any JavaScript environment. UI integrations (e.g., for React) can be built on top.
*   **Implicit Families**: Parameterized atoms are automatically treated as families, simplifying creation.
*   **Type-Safe**: Written in TypeScript with a focus on inference and type safety.
*   **Fine-Grained Updates**: Only components subscribed to changed atoms are notified.

## Comparison with Alternatives

`@atoma/core` aims for a sweet spot of minimalism, flexibility, and power. Here's how it compares to other popular libraries (bundle sizes are approximate minified + gzipped values):

| Library             | Approx. Size (gzip) | Core Concept(s)                                  | Strengths                                                                 | Potential Drawbacks                                                     |
| :------------------ | :------------------ | :----------------------------------------------- | :------------------------------------------------------------------------ | :---------------------------------------------------------------------- |
| **@atoma/core**     | **~2.9 KB**         | Unified `atom()`, `store()`                      | Extremely minimal API, handles diverse state types, framework-agnostic    | Newer ecosystem, fewer dedicated devtools (currently)                   |
| Zustand             | ~1.2 KB             | Hooks-based, single store                        | Very small, simple API, good for hook-based state                         | Primarily React-focused, less structured than Redux                     |
| Jotai               | ~2-4 KB             | Atomic model (like Recoil), hooks                | Small, flexible, bottom-up approach, solves React context issues        | Primarily React-focused                                                 |
| Valtio              | ~1.5 KB             | Proxy-based mutable state                        | Simple mutable API (like MobX), small size                                | Primarily React-focused, mutation tracking can have edge cases          |
| Recoil              | ~7-10 KB            | Atomic model, multiple atom types, selectors     | Facebook-backed, good for complex state graphs                            | Larger bundle size, React-only, string keys                             |
| MobX                | ~15-20 KB           | Observable state, reactions, mutable             | Mature, powerful, object-oriented friendly, good devtools                 | Larger bundle size, requires understanding reactivity concepts          |
| @reduxjs/toolkit    | ~10-15 KB           | Single store, reducers, actions, selectors       | Mature, large ecosystem, predictable state flow, excellent devtools       | Boilerplate (though reduced by Toolkit), largest bundle size            |
| @preact/signals-core| ~1-2 KB             | Signals, fine-grained reactivity                 | Extremely small, highly performant fine-grained updates                   | Different reactivity paradigm, primarily focused on Preact/React        |

**Syntax Elegance:**

`@atoma/core` prioritizes a single, versatile `atom()` function. This contrasts with:
*   **Redux Toolkit**: Requires defining slices, reducers, actions, and using selectors.
*   **Recoil**: Uses distinct `atom()`, `selector()`, `atomFamily()`, `selectorFamily()`.
*   **MobX**: Uses decorators or `makeObservable`.

The goal is to reduce boilerplate and cognitive load by providing one core primitive.

**Feature Parity:**

*   **Strengths of @atoma/core**:
    *   Handles a wide range of state types (sync, async, computed, stream, model, family) through one API.
    *   Implicit families reduce boilerplate for parameterized state.
    *   Potentially very small bundle size compared to more feature-rich libraries like MobX or Redux Toolkit.
    *   Framework-agnostic core allows for integrations with any UI library or vanilla JS.
*   **Potential Gaps/Differences**:
    *   **DevTools**: Currently lacks dedicated browser devtools like Redux or MobX (though basic inspection is possible).
    *   **Middleware/Persistence**: No built-in middleware system like Redux or persistence adapters like Zustand/Jotai (though these can be implemented manually).
    *   **Ecosystem**: Being newer, it has a smaller community and fewer pre-built integrations compared to established libraries.
    *   **Opinionation**: Less opinionated than Redux Toolkit regarding state structure and updates.

## Performance Considerations

`@atoma/core` is designed with performance in mind:

*   **Fine-grained Subscriptions**: Components/subscribers are only notified if the specific atoms they depend on change.
*   **Automatic Dependency Tracking**: Computed atoms automatically track their dependencies and only recompute when necessary.

Direct, universal benchmarking against other libraries is complex and often depends heavily on the specific application patterns. However, the design focuses on minimizing unnecessary computations and updates.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

ISC (See `package.json`)