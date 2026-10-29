import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/services/**", "src/server/**", "src/providers/**"],
      exclude: ["**/*.test.ts"],
      // Slightly below the measured values so platform-specific branches don't flip the result.
      thresholds: { statements: 87, branches: 78, functions: 89, lines: 88 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
