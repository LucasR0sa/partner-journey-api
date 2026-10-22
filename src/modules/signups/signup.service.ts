// ─────────────────────────────────────────────────────────────────────────────
// DIA 1 · BLOCO 2 — Cadastro do parceiro + matching com o lead de origem
// Leia antes: docs/adr/0002-matching-lead-cadastro.md
// Use o módulo de leads como modelo (schema → service → repository → routes).
// ─────────────────────────────────────────────────────────────────────────────
import type { SignupWebhook } from "./signup.schema.js";

const MATCH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

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
  signup: {
    emailNorm: string | null;
    phoneNorm: string | null;
    signedUpAt: Date;
  },
  candidates: LeadCandidate[],
): { leadId: number | null; method: MatchMethod } {
  const validCandidates = candidates.filter((candidate) => {
    const elapsed =
      signup.signedUpAt.getTime() - candidate.occurredAt.getTime();

    return elapsed > 0 && elapsed <= MATCH_WINDOW_MS;
  });

  // Coloca os candidatos do mais recente para o mais antigo.
  validCandidates.sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  );

  // Primeiro, procura pelo e-mail.
  if (signup.emailNorm) {
    const emailMatch = validCandidates.find(
      (candidate) => candidate.emailNorm === signup.emailNorm,
    );

    if (emailMatch) {
      return { leadId: emailMatch.id, method: "email" };
    }
  }

  // Se nenhum e-mail correspondeu, procura pelo telefone.
  if (signup.phoneNorm) {
    const phoneMatch = validCandidates.find(
      (candidate) => candidate.phoneNorm === signup.phoneNorm,
    );

    if (phoneMatch) {
      return { leadId: phoneMatch.id, method: "phone" };
    }
  }

  // Nenhuma correspondência encontrada.
  return { leadId: null, method: "none" };
}

// TODO: createSignupService(repo) com ingest(payload: SignupWebhook):
//   - normaliza e-mail/telefone (src/shared/normalize.ts)
//   - busca candidatos no repositório (leads com o mesmo e-mail OU telefone)
//   - chama pickOriginLead e faz UPSERT em partners (ON CONFLICT (crm_code))
export type { SignupWebhook };
