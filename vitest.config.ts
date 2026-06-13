import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest configuration.
 *
 * - jsdom environment for DOM-touching tests
 * - Picks up every *.test.ts / *.spec.ts / *.test.tsx / *.spec.tsx file
 *   under src/
 * - Mirrors the Next.js @/* alias so test imports match app imports
 * - Loads a setup file that injects the env vars required by src/lib/env.ts
 *   (which validates eagerly on import) so the unit tests can exercise the
 *   env module without needing a real .env.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
