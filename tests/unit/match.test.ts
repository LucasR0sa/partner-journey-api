import { describe, expect, it } from "vitest";
import {
  pickOriginLead,
  type LeadCandidate,
} from "../../src/modules/signups/signup.service.js";

// Regras de matching e limites da janela de atribuição (ADR 0002).
const signup = {
  emailNorm: "ana@exemplo.com",
  phoneNorm: "48999991234",
  signedUpAt: new Date("2026-10-10T12:00:00Z"),
};
const lead = (
  id: number,
  daysBefore: number,
  emailNorm: string | null,
  phoneNorm: string | null,
): LeadCandidate => ({
  id,
  emailNorm,
  phoneNorm,
  occurredAt: new Date(signup.signedUpAt.getTime() - daysBefore * 86_400_000),
});

describe("pickOriginLead (ADR 0002)", () => {
  it("prefere e-mail a telefone, mesmo que o lead por telefone seja mais recente", () => {
    expect(
      pickOriginLead(signup, [
        lead(1, 1, null, "48999991234"),
        lead(2, 5, "ana@exemplo.com", null),
      ]),
    ).toEqual({ leadId: 2, method: "email" });
  });
  it("entre dois leads por e-mail, vence o mais recente (last touch)", () => {
    expect(
      pickOriginLead(signup, [
        lead(1, 30, "ana@exemplo.com", null),
        lead(2, 3, "ana@exemplo.com", null),
      ]),
    ).toEqual({ leadId: 2, method: "email" });
  });
  it("cai para telefone quando não há e-mail", () => {
    expect(pickOriginLead(signup, [lead(7, 2, null, "48999991234")])).toEqual({
      leadId: 7,
      method: "phone",
    });
  });
  it("ignora lead posterior ao cadastro e lead com mais de 90 dias", () => {
    expect(
      pickOriginLead(signup, [
        lead(1, -1, "ana@exemplo.com", null),
        lead(2, 91, "ana@exemplo.com", null),
      ]),
    ).toEqual({ leadId: null, method: "none" });
  });
  it("aceita lead exatamente 90 dias antes do cadastro", () => {
    expect(
      pickOriginLead(signup, [lead(90, 90, signup.emailNorm, null)]),
    ).toEqual({ leadId: 90, method: "email" });
  });
  it("ignora lead no mesmo instante do cadastro", () => {
    expect(
      pickOriginLead(signup, [lead(1, 0, signup.emailNorm, signup.phoneNorm)]),
    ).toEqual({ leadId: null, method: "none" });
  });
  it("casa por telefone quando cadastro e lead não têm e-mail", () => {
    const signupWithoutEmail = { ...signup, emailNorm: null };
    expect(
      pickOriginLead(signupWithoutEmail, [lead(7, 2, null, signup.phoneNorm)]),
    ).toEqual({ leadId: 7, method: "phone" });
  });
});
