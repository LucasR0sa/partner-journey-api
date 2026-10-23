// ─────────────────────────────────────────────────────────────────────────────
// DIA 1 · BLOCO 3 — Sincronização incremental da produção
// Leia antes: docs/adr/0003-sincronizacao-incremental.md
// ─────────────────────────────────────────────────────────────────────────────
import type { Db } from "../../db/pool.js";
import type { Alerter } from "../../shared/alerts/discord.js";
import { logger } from "../../shared/logger.js";
import { withRetry } from "../../shared/retry.js";
import { CrmHttpError, type CrmClient } from "./crm-client.js";
import { createSyncRepository } from "./sync.repository.js";

export const JOB_NAME = "production_sync";

export interface SyncResult {
  pages: number;
  upserted: number;
  unlinked: number;
}

/**
 * Passo a passo esperado:
 *  1. Ler o cursor salvo em sync_state (job = JOB_NAME).
 *  2. Buscar páginas no CRM com withRetry (src/shared/retry.ts) — só re-tentar se err.retryable.
 *  3. Para cada página, em UMA transação:
 *       - UPSERT em production (ON CONFLICT (crm_contract_id) DO UPDATE)
 *       - preservar contratos sem cadastro com partner_code e partner_id null
 *       - salvar o próximo cursor (ou manter o atual na última página)
 *     Assim, se cair no meio, recomeça da última página confirmada — sem duplicar.
 *  4. Ao terminar: last_success_at = now(), last_error = null.
 *  5. Se falhar: grava last_error e chama alerter.notify(...) com job, cursor e erro.
 */
export async function runProductionSync(deps: {
  db: Db;
  crm: CrmClient;
  alerter: Alerter;
  full?: boolean;
  retry?: {
    attempts?: number;
    baseMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
}): Promise<SyncResult> {
  const repo = createSyncRepository(deps.db);
  const result: SyncResult = {
    pages: 0,
    upserted: 0,
    unlinked: 0,
  };
  let cursor: string | null = null;
  let attempts = 0;

  try {
    if (deps.full) {
      await repo.resetCursor(JOB_NAME);
      logger.warn(
        { job: JOB_NAME },
        "cursor reiniciado para sincronização completa",
      );
    }
    cursor = await repo.getState(JOB_NAME);
    while (true) {
      attempts = 0;
      const page = await withRetry(
        () => {
          attempts++;
          return deps.crm.fetchContracts(cursor);
        },
        {
          attempts: deps.retry?.attempts ?? 5,
          baseMs: deps.retry?.baseMs ?? 500,
          sleep: deps.retry?.sleep,
          shouldRetry: (err) => err instanceof CrmHttpError && err.retryable,
          onRetry: (err, attempt, delayMs) => {
            logger.warn(
              { job: JOB_NAME, cursor, tentativa: attempt, delayMs, err },
              "CRM indisponível; nova tentativa",
            );
          },
        },
      );

      // O cursor final aponta para o início da última página, não para o início de tudo.
      const saved = await repo.savePage(
        JOB_NAME,
        page.data,
        page.next_cursor ?? cursor,
      );
      result.pages++;
      result.upserted += saved.upserted;
      result.unlinked += saved.unlinked;
      if (page.next_cursor === null) break;
      cursor = page.next_cursor;
    }

    await repo.markSuccess(JOB_NAME);
    logger.info(
      { job: JOB_NAME, ...result },
      "sincronização de produção concluída",
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await repo.markFailure(JOB_NAME, message);
    } catch (stateError) {
      logger.error(
        { err: stateError, job: JOB_NAME },
        "falha ao registrar o erro da sincronização",
      );
    }
    try {
      await deps.alerter.notify("Sync de produção falhou", {
        job: JOB_NAME,
        cursor: cursor ?? "início",
        erro: message,
        tentativas: attempts,
      });
    } catch (alertError) {
      // A indisponibilidade do alerta não pode esconder a falha original.
      logger.error(
        { err: alertError, job: JOB_NAME },
        "falha ao enviar alerta da sincronização",
      );
    }
    logger.error(
      { job: JOB_NAME, cursor, erro: message, tentativas: attempts, ...result },
      "sincronização de produção falhou",
    );
    throw err;
  }
}
