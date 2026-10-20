import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Testes de integração compartilham o mesmo banco: rodam um arquivo por vez.
    fileParallelism: false,
    setupFiles: ["tests/setup-env.ts"],
  },
});
