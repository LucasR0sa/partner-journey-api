import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(body: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// Compara em tempo constante: um "===" vazaria, pelo tempo de resposta,
// quantos caracteres da assinatura estão certos (timing attack).
export function verifySignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(sign(body, secret), "hex");
  const received = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
