import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Mirror the app's tsconfig path aliases so web-side tests (e.g. the GoDice protocol,
  // issue #50) can import `@shared/*` / `@/*` the same way the app does. Most are type-only
  // imports that esbuild strips, but the aliases keep value imports working too. List the
  // more specific `@shared` before `@` so it wins the prefix match.
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src", import.meta.url)),
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
  test: {
    // The pure engine/protocol/state suites live under src/; web/src holds browser-side
    // pure logic that's still unit-testable in node (no DOM needed), like GoDice parsing.
    include: ["src/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
  },
});
