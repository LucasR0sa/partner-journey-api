import { setTimeout as delay } from "node:timers/promises";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Db } from "../../src/db/pool.js";
import {
  JOB_NAME,
  runProductionSync,
} from "../../src/modules/production/sync.job.js";
import { createSyncRepository } from "../../src/modules/production/sync.repository.js";
import { createSignupRepository } from "../../src/modules/signups/signup.repository.js";
import { logger } from "../../src/shared/logger.js";
import { resetDb, setupTestDb } from "../helpers/db.js";

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => db?.end());

const contract = {
  contract_id: "CT-race",
  partner_code: "P-race",
  amount_cents: 10000,
  paid_at: "2026-05-01",
};
const partner = {
  crmCode: "P-race",
  name: "Parceiro concorrente",
  emailNorm: null,
  phoneNorm: null,
  leadId: null,
  matchMethod: "none" as const,
  signedUpAt: new Date("2026-05-02"),
};

async function partnerId(): Promise<number | null> {
  return (
    await db.query(
      "SELECT partner_id FROM production WHERE crm_contract_id = $1",
      [contract.contract_id],
    )
  ).rows[0].partner_id;
}

// Aguarda uma condição observável no Postgres, sem depender de um sleep arbitrário.
async function waitForBlockedReplay(blockerPid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `SELECT pid FROM pg_stat_activity
      WHERE $1 = ANY(pg_blocking_pids(pid)) AND query LIKE '%INSERT INTO production%'`,
      [blockerPid],
    );
    if (rows.length) return;
    await delay(10);
  }
  throw new Error("A releitura não chegou ao conflito esperado no PostgreSQL");
}

describe("Corrida sync × cadastro", () => {
  it("reconcilia contrato confirmado depois do UPDATE do cadastro sem reler sua página", async () => {
    const connectionA = await db.connect();
    let transactionOpen = false;
    let createdPartnerId: number;
    try {
      await connectionA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      transactionOpen = true;
      const pidA = (await connectionA.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      const pidB = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      expect(pidA).not.toBe(pidB);
      await connectionA.query(
        `INSERT INTO production (crm_contract_id, partner_code, partner_id, amount_cents, paid_at)
        VALUES ($1, $2, null, $3, $4)`,
        [
          contract.contract_id,
          contract.partner_code,
          contract.amount_cents,
          contract.paid_at,
        ],
      );

      // A conexão A continua reservada: o repository cadastra e confirma em outra conexão.
      const created = await createSignupRepository(db).upsertPartner(partner);
      createdPartnerId = created.id;
      expect(created).toMatchObject({ inserted: true, linkedContracts: 0 });
      expect(
        (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
      ).toBe(0);
      await connectionA.query("COMMIT");
      transactionOpen = false;
    } finally {
      if (transactionOpen) await connectionA.query("ROLLBACK");
      connectionA.release();
    }
    expect(await partnerId()).toBeNull();
    const repo = createSyncRepository(db);
    await repo.savePage(JOB_NAME, [], "ultima-pagina");
    const fetchContracts = vi.fn(async () => ({ data: [], next_cursor: null }));
    const notify = vi.fn(async () => {});
    const info = vi.spyOn(logger, "info");
    try {
      const result = await runProductionSync({
        db,
        crm: { fetchContracts },
        alerter: { notify },
      });
      expect(await partnerId()).toBe(createdPartnerId!);
      expect(result).toEqual({
        pages: 1,
        upserted: 0,
        unlinked: 0,
        relinked: 1,
      });
      expect(fetchContracts).toHaveBeenCalledExactlyOnceWith("ultima-pagina");
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({ relinked: 1 }),
        "sincronização de produção concluída",
      );
      expect(notify).not.toHaveBeenCalled();
      expect(
        (
          await db.query(
            "SELECT last_success_at, last_error FROM sync_state WHERE job = $1",
            [JOB_NAME],
          )
        ).rows,
      ).toEqual([{ last_success_at: expect.any(Date), last_error: null }]);
      await expect(
        runProductionSync({ db, crm: { fetchContracts }, alerter: { notify } }),
      ).resolves.toEqual({ ...result, relinked: 0 });
    } finally {
      info.mockRestore();
    }
  });

  it("releitura com parceiro ainda invisível não apaga um vínculo confirmado durante o conflito", async () => {
    const repo = createSyncRepository(db);
    await repo.savePage(JOB_NAME, [contract], "ultima-pagina");
    const signupConnection = await db.connect();
    let transactionOpen = false;
    let replay:
      | Promise<
          { value: { upserted: number; unlinked: number } } | { error: unknown }
        >
      | undefined;
    try {
      await signupConnection.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      transactionOpen = true;
      const pid = (
        await signupConnection.query("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      const created = await signupConnection.query(
        `INSERT INTO partners (crm_code, name, signed_up_at)
        VALUES ($1, $2, $3) RETURNING id`,
        [partner.crmCode, partner.name, partner.signedUpAt],
      );
      const id = created.rows[0].id;
      await signupConnection.query(
        "UPDATE production SET partner_id = $1 WHERE crm_contract_id = $2",
        [id, contract.contract_id],
      );

      // savePage lê parceiros sem enxergar o cadastro aberto e bloqueia no UPSERT do contrato.
      replay = repo
        .savePage(
          JOB_NAME,
          [{ ...contract, amount_cents: 20000 }],
          "ultima-pagina",
        )
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await waitForBlockedReplay(pid);
      await signupConnection.query("COMMIT");
      transactionOpen = false;
      const outcome = await replay;
      if ("error" in outcome) throw outcome.error;
      expect(await partnerId()).toBe(id);
      expect(outcome.value).toEqual({ upserted: 1, unlinked: 0 });
      expect(
        (
          await db.query(
            "SELECT amount_cents FROM production WHERE crm_contract_id = $1",
            [contract.contract_id],
          )
        ).rows,
      ).toEqual([{ amount_cents: 20000 }]);
    } finally {
      if (transactionOpen) await signupConnection.query("ROLLBACK");
      signupConnection.release();
      await replay;
    }
  }, 10000);
});
