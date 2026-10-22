import type { Db } from "../../db/pool.js";
import type { CrmPage } from "./crm-client.js";

export type CrmContract = CrmPage["data"][number];

export interface SavedPage {
  upserted: number;
  skippedUnknownPartner: number;
}

export function createSyncRepository(db: Db) {
  return {
    async getState(job: string): Promise<string | null> {
      const { rows } = await db.query<{ cursor: string | null }>(
        "SELECT cursor FROM sync_state WHERE job = $1",
        [job],
      );
      return rows[0]?.cursor ?? null;
    },

    async savePage(
      job: string,
      contracts: CrmContract[],
      nextCursor: string | null,
    ): Promise<SavedPage> {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const codes = [...new Set(contracts.map((c) => c.partner_code))];
        const { rows } = await client.query<{ id: number; crm_code: string }>(
          "SELECT id, crm_code FROM partners WHERE crm_code = ANY($1)",
          [codes],
        );
        const partnerIds = new Map(rows.map((row) => [row.crm_code, row.id]));
        const result: SavedPage = { upserted: 0, skippedUnknownPartner: 0 };

        for (const contract of contracts) {
          const partnerId = partnerIds.get(contract.partner_code);
          if (partnerId === undefined) {
            result.skippedUnknownPartner++;
            continue;
          }
          await client.query(
            `INSERT INTO production
               (crm_contract_id, partner_id, amount_cents, paid_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (crm_contract_id) DO UPDATE SET
               partner_id = EXCLUDED.partner_id,
               amount_cents = EXCLUDED.amount_cents,
               paid_at = EXCLUDED.paid_at,
               synced_at = now()`,
            [
              contract.contract_id,
              partnerId,
              contract.amount_cents,
              contract.paid_at,
            ],
          );
          result.upserted++;
        }

        // Avançar o cursor só é seguro se todos os contratos da página forem confirmados.
        await client.query(
          `INSERT INTO sync_state (job, cursor) VALUES ($1, $2)
           ON CONFLICT (job) DO UPDATE SET
             cursor = EXCLUDED.cursor, updated_at = now()`,
          [job, nextCursor],
        );
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async markSuccess(job: string): Promise<void> {
      await db.query(
        `INSERT INTO sync_state (job, last_success_at, last_error)
         VALUES ($1, now(), null)
         ON CONFLICT (job) DO UPDATE SET
           last_success_at = now(), last_error = null, updated_at = now()`,
        [job],
      );
    },

    async markFailure(job: string, message: string): Promise<void> {
      // O cursor confirmado sobrevive à falha para permitir a retomada.
      await db.query(
        `INSERT INTO sync_state (job, last_error) VALUES ($1, $2)
         ON CONFLICT (job) DO UPDATE SET
           last_error = EXCLUDED.last_error, updated_at = now()`,
        [job, message],
      );
    },
  };
}
