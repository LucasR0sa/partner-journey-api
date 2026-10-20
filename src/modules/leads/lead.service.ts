import { HttpError } from "../../shared/http/errors.js";
import { normalizeEmail, normalizePhoneBR } from "../../shared/normalize.js";
import type { LeadRepository } from "./lead.repository.js";
import type { LeadWebhook } from "./lead.schema.js";

export type IngestResult = { status: "created"; leadId: number } | { status: "duplicate" };

// Regra de negócio sem Express e sem SQL: dá para testar com um repositório falso.
export function createLeadService(repo: LeadRepository) {
  return {
    async ingest(payload: LeadWebhook): Promise<IngestResult> {
      const emailNorm = normalizeEmail(payload.contact.email);
      const phoneNorm = normalizePhoneBR(payload.contact.phone);
      if (!emailNorm && !phoneNorm) {
        throw new HttpError(422, "e-mail e telefone inválidos: lead sem contato utilizável", "invalid_contact");
      }
      const leadId = await repo.insertIfNew({
        eventId: payload.event_id,
        source: payload.source.toLowerCase(),
        campaign: payload.campaign ?? null,
        emailNorm,
        phoneNorm,
        occurredAt: payload.occurred_at,
      });
      return leadId === null ? { status: "duplicate" } : { status: "created", leadId };
    },
  };
}

export type LeadService = ReturnType<typeof createLeadService>;
