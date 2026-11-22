import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

// Component-level interaction tests only (Feature 3/B4's explicit requirement) - separate from
// test:unit's pure-logic node --test suite, same "@" alias as vite.config.ts so component imports
// never need a different path than the app itself uses.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": "/src" } },
  test: { environment: "jsdom", globals: false, setupFiles: ["./src/test/setup.ts"] },
});
