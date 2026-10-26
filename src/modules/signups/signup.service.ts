// As regras de matching ficam na função pura para serem auditadas e testadas sem banco (ADR 0002).
import { normalizeEmail, normalizePhoneBR } from "../../shared/normalize.js";
import { logger } from "../../shared/logger.js";
import type { SignupRepository } from "./signup.repository.js";
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

export interface SignupIngestResult {
  status: "created" | "updated";
  partnerId: number;
  leadId: number | null;
  matchMethod: MatchMethod;
  linkedContracts: number;
}

export function createSignupService(repo: SignupRepository) {
  return {
    async ingest(payload: SignupWebhook): Promise<SignupIngestResult> {
      const emailNorm = normalizeEmail(payload.email);
      const phoneNorm = normalizePhoneBR(payload.phone);
      const candidates = await repo.findCandidates(emailNorm, phoneNorm);
      const match = pickOriginLead(
        { emailNorm, phoneNorm, signedUpAt: payload.signed_up_at },
        candidates,
      );

      // O cadastro pode existir sem origem; o vínculo fica explícito e auditável.
      const partner = await repo.upsertPartner({
        crmCode: payload.crm_code,
        name: payload.name,
        emailNorm,
        phoneNorm,
        leadId: match.leadId,
        matchMethod: match.method,
        signedUpAt: payload.signed_up_at,
      });
      const result: SignupIngestResult = {
        status: partner.inserted ? "created" : "updated",
        partnerId: partner.id,
        leadId: match.leadId,
        matchMethod: match.method,
        linkedContracts: partner.linkedContracts,
      };
      logger.info(
        { crmCode: payload.crm_code, ...result },
        "cadastro processado e produção pendente vinculada",
      );
      return result;
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;
export type { SignupWebhook };
