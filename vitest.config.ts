import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Use global APIs like describe, it, expect
    environment: 'node', // Or 'jsdom' if testing browser-specific features
    // reporters: ['verbose'], // Optional: more detailed reporting
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/types.ts', // Exclude type definitions
        'src/index.ts', // Exclude main export file
        '**/*.spec.ts', // Exclude test files themselves
        '**/*.test.ts',
      ],
    },
  },
});
