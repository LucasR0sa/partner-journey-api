import type { Db } from "../../db/pool.js";
import type { LeadCandidate, MatchMethod } from "./signup.service.js";

export interface NewPartner {
  crmCode: string;
  name: string;
  emailNorm: string | null;
  phoneNorm: string | null;
  leadId: number | null;
  matchMethod: MatchMethod;
  signedUpAt: Date;
}

export interface SignupRepository {
  findCandidates(
    emailNorm: string | null,
    phoneNorm: string | null,
  ): Promise<LeadCandidate[]>;
  upsertPartner(
    partner: NewPartner,
  ): Promise<{ id: number; inserted: boolean; linkedContracts: number }>;
}

export function createSignupRepository(db: Db): SignupRepository {
  return {
    async findCandidates(emailNorm, phoneNorm) {
      // Sem contato não existe origem possível; evita uma consulta sem resultado.
      if (emailNorm === null && phoneNorm === null) return [];

      const { rows } = await db.query<{
        id: number;
        email_norm: string | null;
        phone_norm: string | null;
        occurred_at: Date;
      }>(
        `SELECT id, email_norm, phone_norm, occurred_at
         FROM leads
         WHERE email_norm = $1 OR phone_norm = $2`,
        [emailNorm, phoneNorm],
      );
      return rows.map((row) => ({
        id: row.id,
        emailNorm: row.email_norm,
        phoneNorm: row.phone_norm,
        occurredAt: row.occurred_at,
      }));
    },

    async upsertPartner(partner) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        // A chave do CRM resolve reenvios e concorrência sem um SELECT antes do INSERT.
        const { rows } = await client.query<{ id: number; inserted: boolean }>(
          `INSERT INTO partners
           (crm_code, name, email_norm, phone_norm, lead_id, match_method, signed_up_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (crm_code) DO UPDATE SET
           name = EXCLUDED.name,
           email_norm = EXCLUDED.email_norm,
           phone_norm = EXCLUDED.phone_norm,
           lead_id = EXCLUDED.lead_id,
           match_method = EXCLUDED.match_method,
           signed_up_at = EXCLUDED.signed_up_at
         RETURNING id, (xmax = 0) AS inserted`,
          [
            partner.crmCode,
            partner.name,
            partner.emailNorm,
            partner.phoneNorm,
            partner.leadId,
            partner.matchMethod,
            partner.signedUpAt,
          ],
        );
        const result = rows[0];
        if (!result) throw new Error("UPSERT não retornou o parceiro");
        // Cadastro e vínculo confirmam juntos: a produção pode ter chegado antes.
        const linked = await client.query(
          `UPDATE production SET partner_id = $1
         WHERE partner_code = $2 AND partner_id IS NULL`,
          [result.id, partner.crmCode],
        );
        await client.query("COMMIT");
        return { ...result, linkedContracts: linked.rowCount ?? 0 };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
