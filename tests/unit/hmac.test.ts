import { describe, expect, it } from "vitest";
import { sign, verifySignature } from "../../src/shared/security/hmac.js";

const secret = "segredo-de-teste-com-32-caracteres!";
const body = Buffer.from('{"event_id":"e1"}');

describe("verifySignature", () => {
  it("aceita assinatura correta, com ou sem prefixo sha256=", () => {
    expect(verifySignature(body, sign(body, secret), secret)).toBe(true);
    expect(verifySignature(body, `sha256=${sign(body, secret)}`, secret)).toBe(true);
  });
  it("recusa corpo alterado, segredo errado ou assinatura ausente", () => {
    expect(verifySignature(Buffer.from('{"event_id":"e2"}'), sign(body, secret), secret)).toBe(false);
    expect(verifySignature(body, sign(body, "outro-segredo-qualquer"), secret)).toBe(false);
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, "abc", secret)).toBe(false);
  });
});
