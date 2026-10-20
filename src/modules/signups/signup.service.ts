// ─────────────────────────────────────────────────────────────────────────────
// DIA 1 · BLOCO 2 — Cadastro do parceiro + matching com o lead de origem
// Leia antes: docs/adr/0002-matching-lead-cadastro.md
// Use o módulo de leads como modelo (schema → service → repository → routes).
// ─────────────────────────────────────────────────────────────────────────────
import type { SignupWebhook } from "./signup.schema.js";

export type MatchMethod = "email" | "phone" | "none";

export interface LeadCandidate {
  id: number;
  emailNorm: string | null;
  phoneNorm: string | null;
  occurredAt: Date;
}

/**
 * Escolhe o lead de origem de um cadastro. Função PURA: sem banco, fácil de testar.
 *
 * Regras (ADR 0002):
 *  1. Só valem leads que aconteceram ANTES do cadastro e no máximo 90 dias antes.
 *  2. E-mail tem prioridade sobre telefone (e-mail erra menos; telefone é reaproveitado).
 *  3. Havendo mais de um, vence o lead MAIS RECENTE (atribuição "last touch").
 *  4. Nenhum candidato → { leadId: null, method: "none" }.
 */
export function pickOriginLead(
  _signup: { emailNorm: string | null; phoneNorm: string | null; signedUpAt: Date },
  _candidates: LeadCandidate[],
): { leadId: number | null; method: MatchMethod } {
  // TODO: implemente as 4 regras acima. Os testes em tests/unit/match.test.ts já descrevem os casos.
  throw new Error("pickOriginLead: não implementado (dia 1 · bloco 2)");
}

// TODO: createSignupService(repo) com ingest(payload: SignupWebhook):
//   - normaliza e-mail/telefone (src/shared/normalize.ts)
//   - busca candidatos no repositório (leads com o mesmo e-mail OU telefone)
//   - chama pickOriginLead e faz UPSERT em partners (ON CONFLICT (crm_code))
export type { SignupWebhook };
