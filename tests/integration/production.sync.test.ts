import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../src/app.js";
import type { Db } from "../../src/db/pool.js";
import {
  CrmHttpError,
  type CrmClient,
  type CrmPage,
} from "../../src/modules/production/crm-client.js";
import {
  JOB_NAME,
  runProductionSync,
} from "../../src/modules/production/sync.job.js";
import {
  createSyncRepository,
  type CrmContract,
} from "../../src/modules/production/sync.repository.js";
import type { Alerter } from "../../src/shared/alerts/discord.js";
import { logger } from "../../src/shared/logger.js";
import { resetDb, setupTestDb } from "../helpers/db.js";
import { postSigned } from "../helpers/webhook.js";

let db: Db;
const noSleep = async () => {};
const fastRetry = { baseMs: 0, sleep: noSleep };

beforeAll(async () => {
  db = await setupTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  await db.query(
    `INSERT INTO partners (crm_code, name, match_method, signed_up_at)
     VALUES ('P0001', 'Parceiro 1', 'none', '2026-04-01'),
            ('P0002', 'Parceiro 2', 'none', '2026-04-01')`,
  );
});
afterAll(() => db?.end());

const contract = (
  id: string,
  overrides: Partial<CrmContract> = {},
): CrmContract => ({
  contract_id: id,
  partner_code: "P0001",
  amount_cents: 10_000,
  paid_at: "2026-05-01",
  ...overrides,
});

const pages = (): Record<string, CrmPage> => ({
  início: {
    data: [contract("CT-1"), contract("CT-2")],
    next_cursor: "pagina-2",
  },
  "pagina-2": {
    data: [contract("CT-3"), contract("CT-4")],
    next_cursor: "pagina-3",
  },
  "pagina-3": {
    data: [contract("CT-5"), contract("CT-6")],
    next_cursor: null,
  },
});

// Cursores são opacos: o job não depende dos offsets numéricos do fake-crm.
function fakeCrm(
  data: Record<string, CrmPage>,
  beforeFetch?: (cursor: string | null) => void,
) {
  const calls: (string | null)[] = [];
  const crm: CrmClient = {
    async fetchContracts(cursor) {
      calls.push(cursor);
      beforeFetch?.(cursor);
      const page = data[cursor ?? "início"];
      if (!page) throw new Error(`página inexistente: ${cursor}`);
      return page;
    },
  };
  return { crm, calls };
}

function fakeAlerter(onNotify?: () => Promise<void>) {
  const alerts: { title: string; details: Record<string, string | number> }[] =
    [];
  const alerter: Alerter = {
    async notify(title, details) {
      alerts.push({ title, details });
      await onNotify?.();
    },
  };
  return { alerter, alerts };
}

describe("runProductionSync", () => {
  it("vincula produção de uma página antiga no cadastro, sem buscar o CRM novamente", async () => {
    const data = pages();
    data.início!.data.push(
      contract("CT-before-signup", { partner_code: "P0003" }),
    );
    const { crm, calls } = fakeCrm(data);
    const { alerter } = fakeAlerter();
    const app = createApp({
      db,
      env: { WEBHOOK_SECRET: process.env.WEBHOOK_SECRET! },
    });
    const info = vi.spyOn(logger, "info");
    try {
      await expect(
        runProductionSync({ db, crm, alerter, retry: fastRetry }),
      ).resolves.toEqual({ pages: 3, upserted: 7, unlinked: 1, relinked: 0 });
      expect(await createSyncRepository(db).getState(JOB_NAME)).toBe(
        "pagina-3",
      );
      expect(
        (
          await db.query(
            "SELECT partner_id FROM production WHERE crm_contract_id = 'CT-before-signup'",
          )
        ).rows,
      ).toEqual([{ partner_id: null }]);

      const response = await postSigned(app, "/webhooks/signups", {
        event_id: "late-signup",
        crm_code: "P0003",
        name: "Parceiro tardio",
        signed_up_at: "2026-05-02T12:00:00Z",
      });
      expect(response.status).toBe(201);
      expect(
        (
          await db.query(`SELECT p.partner_code, p.partner_id, partner.crm_code
        FROM production p JOIN partners partner ON partner.id = p.partner_id
        WHERE p.crm_contract_id = 'CT-before-signup'`)
        ).rows,
      ).toEqual([
        {
          partner_code: "P0003",
          partner_id: response.body.id,
          crm_code: "P0003",
        },
      ]);
      expect(calls).toEqual([null, "pagina-2", "pagina-3"]);
      expect(await createSyncRepository(db).getState(JOB_NAME)).toBe(
        "pagina-3",
      );
      expect(info).toHaveBeenCalledWith(
        expect.objectContaining({
          crmCode: "P0003",
          linkedContracts: 1,
          status: "created",
        }),
        "cadastro processado e produção pendente vinculada",
      );
    } finally {
      info.mockRestore();
    }
  });

  it("sincroniza todas as páginas e mantém o cursor da última página", async () => {
    const { crm, calls } = fakeCrm(pages());
    const { alerter, alerts } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 3, upserted: 6, unlinked: 0, relinked: 0 });

    expect(calls).toEqual([null, "pagina-2", "pagina-3"]);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
    ).toBe(6);
    expect(
      (
        await db.query(
          "SELECT cursor, last_success_at, last_error FROM sync_state WHERE job = $1",
          [JOB_NAME],
        )
      ).rows,
    ).toEqual([
      {
        cursor: "pagina-3",
        last_success_at: expect.any(Date),
        last_error: null,
      },
    ]);
    expect(alerts).toEqual([]);
  });

  it("não duplica na segunda execução e atualiza os contratos da última página", async () => {
    const data = pages();
    const { crm, calls } = fakeCrm(data);
    const { alerter } = fakeAlerter();
    await runProductionSync({ db, crm, alerter, retry: fastRetry });
    await db.query(
      "UPDATE production SET synced_at = '2000-01-01' WHERE crm_contract_id = 'CT-5'",
    );
    data["pagina-3"]!.data[0] = contract("CT-5", {
      amount_cents: 25_000,
      paid_at: "2026-05-02",
      partner_code: "P0002",
    });
    calls.length = 0;

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 1, upserted: 2, unlinked: 0, relinked: 0 });

    expect(calls).toEqual(["pagina-3"]);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
    ).toBe(6);
    const { rows } = await db.query(
      `SELECT p.amount_cents, p.paid_at::text, p.synced_at, partner.crm_code
       FROM production p JOIN partners partner ON partner.id = p.partner_id
       WHERE p.crm_contract_id = 'CT-5'`,
    );
    expect(rows[0]).toMatchObject({
      amount_cents: 25_000,
      paid_at: "2026-05-02",
      crm_code: "P0002",
    });
    expect(rows[0].synced_at.getTime()).toBeGreaterThan(
      new Date("2000-01-01").getTime(),
    );
    expect(await createSyncRepository(db).getState(JOB_NAME)).toBe("pagina-3");
  });

  it("grava e conta contratos sem parceiro, preservando o código do CRM", async () => {
    const { crm } = fakeCrm({
      início: {
        data: [
          contract("CT-1"),
          contract("CT-unknown", { partner_code: "P0999" }),
        ],
        next_cursor: null,
      },
    });
    const { alerter } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 1, upserted: 2, unlinked: 1, relinked: 0 });
    expect(
      (
        await db.query(
          "SELECT crm_contract_id, partner_code, partner_id FROM production ORDER BY crm_contract_id",
        )
      ).rows,
    ).toEqual([
      {
        crm_contract_id: "CT-1",
        partner_code: "P0001",
        partner_id: expect.any(Number),
      },
      {
        crm_contract_id: "CT-unknown",
        partner_code: "P0999",
        partner_id: null,
      },
    ]);
  });

  it("re-tenta 503 duas vezes e conclui sem esperar de verdade", async () => {
    let failures = 2;
    const { crm, calls } = fakeCrm(
      { início: { data: [contract("CT-1")], next_cursor: null } },
      () => {
        if (failures-- > 0) throw new CrmHttpError(503);
      },
    );
    const { alerter, alerts } = fakeAlerter();
    const delays: number[] = [];

    await expect(
      runProductionSync({
        db,
        crm,
        alerter,
        retry: {
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      }),
    ).resolves.toEqual({ pages: 1, upserted: 1, unlinked: 0, relinked: 0 });

    expect(calls).toEqual([null, null, null]);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(250);
    expect(delays[0]).toBeLessThanOrEqual(500);
    expect(delays[1]).toBeGreaterThanOrEqual(500);
    expect(delays[1]).toBeLessThanOrEqual(1000);
    expect(alerts).toEqual([]);
  });

  it("não re-tenta erro 400", async () => {
    const failure = new CrmHttpError(400);
    const { crm, calls } = fakeCrm(pages(), () => {
      throw failure;
    });
    const { alerter, alerts } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).rejects.toBe(failure);

    expect(calls).toEqual([null]);
    expect(alerts[0]?.details.tentativas).toBe(1);
    expect(
      (
        await db.query(
          "SELECT cursor, last_error FROM sync_state WHERE job = $1",
          [JOB_NAME],
        )
      ).rows,
    ).toEqual([{ cursor: null, last_error: failure.message }]);
  });

  it("esgota cinco tentativas, registra a falha e alerta com job e cursor", async () => {
    await createSyncRepository(db).savePage(JOB_NAME, [], "pagina-2");
    const failure = new CrmHttpError(503);
    const { crm, calls } = fakeCrm(pages(), () => {
      throw failure;
    });
    let errorAtNotification: unknown;
    const { alerter, alerts } = fakeAlerter(async () => {
      const state = await db.query(
        "SELECT last_error FROM sync_state WHERE job = $1",
        [JOB_NAME],
      );
      errorAtNotification = state.rows[0].last_error;
    });

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).rejects.toBe(failure);

    expect(calls).toEqual(Array(5).fill("pagina-2"));
    expect(errorAtNotification).toBe(failure.message);
    expect(alerts).toEqual([
      {
        title: "Sync de produção falhou",
        details: {
          job: JOB_NAME,
          cursor: "pagina-2",
          erro: failure.message,
          tentativas: 5,
        },
      },
    ]);
    expect(await createSyncRepository(db).getState(JOB_NAME)).toBe("pagina-2");
  });

  it("retoma da página 3 após uma falha, sem duplicar as páginas confirmadas", async () => {
    const failure = new CrmHttpError(503);
    let shouldFail = true;
    const { crm, calls } = fakeCrm(pages(), (cursor) => {
      if (cursor === "pagina-3" && shouldFail) throw failure;
    });
    const { alerter } = fakeAlerter();

    await expect(
      runProductionSync({
        db,
        crm,
        alerter,
        retry: { ...fastRetry, attempts: 2 },
      }),
    ).rejects.toBe(failure);
    expect(calls).toEqual([null, "pagina-2", "pagina-3", "pagina-3"]);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
    ).toBe(4);
    expect(await createSyncRepository(db).getState(JOB_NAME)).toBe("pagina-3");

    shouldFail = false;
    calls.length = 0;
    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 1, upserted: 2, unlinked: 0, relinked: 0 });

    expect(calls).toEqual(["pagina-3"]);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
    ).toBe(6);
    expect(
      (
        await db.query(
          "SELECT cursor, last_error, last_success_at FROM sync_state WHERE job = $1",
          [JOB_NAME],
        )
      ).rows,
    ).toEqual([
      {
        cursor: "pagina-3",
        last_error: null,
        last_success_at: expect.any(Date),
      },
    ]);
  });

  it("desfaz inserts, updates e avanço do cursor se a página falhar no meio", async () => {
    await createSyncRepository(db).savePage(
      JOB_NAME,
      [contract("CT-old")],
      "pagina-2",
    );
    const { crm } = fakeCrm({
      "pagina-2": {
        data: [
          contract("CT-old", { amount_cents: 99_999 }),
          contract("CT-new"),
          contract("CT-invalid", { paid_at: "data-inválida" }),
        ],
        next_cursor: "pagina-3",
      },
    });
    const { alerter } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).rejects.toMatchObject({ code: "22007" });

    expect(
      (await db.query("SELECT crm_contract_id, amount_cents FROM production"))
        .rows,
    ).toEqual([{ crm_contract_id: "CT-old", amount_cents: 10_000 }]);
    expect(await createSyncRepository(db).getState(JOB_NAME)).toBe("pagina-2");
    expect(
      (
        await db.query("SELECT last_error FROM sync_state WHERE job = $1", [
          JOB_NAME,
        ])
      ).rows[0].last_error,
    ).toEqual(expect.any(String));
  });

  it("preserva last_error e o erro original mesmo quando o alerter falha", async () => {
    const failure = new CrmHttpError(503);
    const { crm } = fakeCrm(pages(), () => {
      throw failure;
    });
    const { alerter, alerts } = fakeAlerter(async () => {
      throw new Error("Discord indisponível");
    });

    await expect(
      runProductionSync({
        db,
        crm,
        alerter,
        retry: { ...fastRetry, attempts: 1 },
      }),
    ).rejects.toBe(failure);

    expect(alerts).toHaveLength(1);
    expect(
      (
        await db.query("SELECT last_error FROM sync_state WHERE job = $1", [
          JOB_NAME,
        ])
      ).rows[0].last_error,
    ).toBe(failure.message);
  });

  it("re-tenta 429 como erro temporário", async () => {
    let shouldFail = true;
    const { crm, calls } = fakeCrm(
      { início: { data: [], next_cursor: null } },
      () => {
        if (shouldFail) {
          shouldFail = false;
          throw new CrmHttpError(429);
        }
      },
    );
    const { alerter } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 1, upserted: 0, unlinked: 0, relinked: 0 });
    expect(calls).toEqual([null, null]);
  });

  it("não re-tenta outros tipos de erro, mesmo que tenham retryable true", async () => {
    const failure = Object.assign(new Error("dados inválidos"), {
      retryable: true,
    });
    const { crm, calls } = fakeCrm(pages(), () => {
      throw failure;
    });
    const { alerter } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).rejects.toBe(failure);
    expect(calls).toEqual([null]);
  });

  it("encontra contratos novos ao reler a última página", async () => {
    const data = pages();
    const { crm, calls } = fakeCrm(data);
    const { alerter } = fakeAlerter();
    await runProductionSync({ db, crm, alerter, retry: fastRetry });
    data["pagina-3"]!.data.push(contract("CT-7"));
    calls.length = 0;

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 1, upserted: 3, unlinked: 0, relinked: 0 });
    expect(calls).toEqual(["pagina-3"]);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
    ).toBe(7);
  });

  it("conclui um CRM vazio e mantém o início como a única página", async () => {
    const { crm, calls } = fakeCrm({ início: { data: [], next_cursor: null } });
    const { alerter } = fakeAlerter();

    await expect(
      runProductionSync({ db, crm, alerter, retry: fastRetry }),
    ).resolves.toEqual({ pages: 1, upserted: 0, unlinked: 0, relinked: 0 });
    await runProductionSync({ db, crm, alerter, retry: fastRetry });
    expect(calls).toEqual([null, null]);
    expect(
      (
        await db.query(
          "SELECT last_error, last_success_at FROM sync_state WHERE job = $1",
          [JOB_NAME],
        )
      ).rows,
    ).toEqual([{ last_error: null, last_success_at: expect.any(Date) }]);
  });
});
