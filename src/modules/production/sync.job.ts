// ─────────────────────────────────────────────────────────────────────────────
// DIA 1 · BLOCO 3 — Sincronização incremental da produção
// Leia antes: docs/adr/0003-sincronizacao-incremental.md
// ─────────────────────────────────────────────────────────────────────────────
import type { Db } from "../../db/pool.js";
import type { Alerter } from "../../shared/alerts/discord.js";
import type { CrmClient } from "./crm-client.js";

export const JOB_NAME = "production_sync";

export interface SyncResult {
  pages: number;
  upserted: number;
  skippedUnknownPartner: number;
}

/**
 * Passo a passo esperado:
 *  1. Ler o cursor salvo em sync_state (job = JOB_NAME).
 *  2. Buscar páginas no CRM com withRetry (src/shared/retry.ts) — só re-tentar se err.retryable.
 *  3. Para cada página, em UMA transação:
 *       - UPSERT em production (ON CONFLICT (crm_contract_id) DO UPDATE)
 *       - ignorar (e contar) contratos de parceiro que ainda não existe em partners
 *       - salvar o next_cursor em sync_state
 *     Assim, se cair no meio, recomeça da última página confirmada — sem duplicar.
 *  4. Ao terminar: last_success_at = now(), last_error = null.
 *  5. Se esgotar os retries: grava last_error e chama alerter.notify(...) com job, cursor e erro.
 */
export async function runProductionSync(_deps: { db: Db; crm: CrmClient; alerter: Alerter }): Promise<SyncResult> {
  // TODO(dia 1 · bloco 3)
  throw new Error("runProductionSync: não implementado (dia 1 · bloco 3)");
}
