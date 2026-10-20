import type { Db } from "../../db/pool.js";

export interface NewLead {
  eventId: string;
  source: string;
  campaign: string | null;
  emailNorm: string | null;
  phoneNorm: string | null;
  occurredAt: Date;
}

export interface LeadRepository {
  /** Insere o lead. Retorna o id, ou null se o evento já tinha sido recebido. */
  insertIfNew(lead: NewLead): Promise<number | null>;
}

export function createLeadRepository(db: Db): LeadRepository {
  return {
    async insertIfNew(lead) {
      // ON CONFLICT DO NOTHING + UNIQUE(event_id): a idempotência fica no banco,
      // então funciona mesmo com duas réplicas da API recebendo o mesmo evento ao mesmo tempo.
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO leads (event_id, source, campaign, email_norm, phone_norm, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [lead.eventId, lead.source, lead.campaign, lead.emailNorm, lead.phoneNorm, lead.occurredAt],
      );
      return rows[0]?.id ?? null;
    },
  };
}
