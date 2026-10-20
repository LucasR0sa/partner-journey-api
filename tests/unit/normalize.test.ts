import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhoneBR } from "../../src/shared/normalize.js";

describe("normalizeEmail", () => {
  it("remove espaços e deixa minúsculo", () => {
    expect(normalizeEmail("  Ana.Souza@Exemplo.COM ")).toBe("ana.souza@exemplo.com");
  });
  it.each(["", "sem-arroba", "a@b", null, undefined])("rejeita %s", (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });
});

describe("normalizePhoneBR", () => {
  it.each([
    ["(48) 99999-1234", "48999991234"],
    ["+55 48 99999-1234", "48999991234"],
    ["048 99999-1234", "48999991234"],
    ["48 3333-1234", "4833331234"], // fixo continua com 10 dígitos
    ["48 9999-1234", "48999991234"], // celular antigo ganha o 9
  ])("%s → %s", (raw, expected) => {
    expect(normalizePhoneBR(raw)).toBe(expected);
  });
  it.each(["123", "", null])("rejeita %s", (v) => {
    expect(normalizePhoneBR(v)).toBeNull();
  });
});
