import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";

describe("loadEnv", () => {
  it("aplica padrões e converte tipos", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db", WEBHOOK_SECRET: "x".repeat(16), PORT: "8080" });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("development");
  });
  it("falha cedo com mensagem clara", () => {
    expect(() => loadEnv({ WEBHOOK_SECRET: "curto" })).toThrow(/DATABASE_URL[\s\S]*WEBHOOK_SECRET/);
  });
});
