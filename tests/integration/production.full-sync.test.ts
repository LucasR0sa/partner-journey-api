import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { Db } from "../../src/db/pool.js";
import type { CrmPage } from "../../src/modules/production/crm-client.js";
import { JOB_NAME } from "../../src/modules/production/sync.job.js";
import { createSyncRepository } from "../../src/modules/production/sync.repository.js";
import { resetDb, setupTestDb } from "../helpers/db.js";

const execFileAsync = promisify(execFile);
let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => db?.end());

it("npm run sync:full recupera contratos antes ignorados e não duplica os existentes", async () => {
  await db.query(`INSERT INTO partners (crm_code, name, signed_up_at)
    VALUES ('P0001', 'Parceiro conhecido', '2026-05-01')`);
  const known = {
    contract_id: "CT-known",
    partner_code: "P0001",
    amount_cents: 10000,
    paid_at: "2026-05-02",
  };
  const missing = {
    ...known,
    contract_id: "CT-previously-ignored",
    partner_code: "P0003",
  };
  const last = { ...known, contract_id: "CT-last" };
  // Simula o estado antigo: contrato ausente e cursor já avançado para a última página.
  const repo = createSyncRepository(db);
  await repo.savePage(JOB_NAME, [known, last], "pagina-2");
  const pages: Record<string, CrmPage> = {
    início: { data: [known, missing], next_cursor: "pagina-2" },
    "pagina-2": { data: [last], next_cursor: null },
  };
  const calls: (string | null)[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://crm.test");
    if (url.pathname !== "/contracts") return void res.writeHead(404).end();
    const cursor = url.searchParams.get("cursor");
    calls.push(cursor);
    const page = pages[cursor ?? "início"];
    if (!page) return void res.writeHead(400).end();
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(page));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Porta de teste inválida");
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Execute este teste com npm test");
    const runFull = async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [npmCli, "run", "sync:full"],
        {
          env: {
            ...process.env,
            DATABASE_URL: process.env.DATABASE_URL!,
            CRM_BASE_URL: `http://127.0.0.1:${address.port}`,
            DISCORD_WEBHOOK_URL: "",
            LOG_LEVEL: "info",
          },
          timeout: 15000,
          windowsHide: true,
        },
      );
      const logs = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line));
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            job: JOB_NAME,
            pages: 2,
            upserted: 3,
            unlinked: 1,
          }),
        ]),
      );
    };
    await runFull();
    expect(calls).toEqual([null, "pagina-2"]);
    expect(
      (
        await db.query(
          "SELECT partner_code, partner_id FROM production WHERE crm_contract_id = 'CT-previously-ignored'",
        )
      ).rows,
    ).toEqual([{ partner_code: "P0003", partner_id: null }]);
    expect(await repo.getState(JOB_NAME)).toBe("pagina-2");
    await runFull();
    expect(calls).toEqual([null, "pagina-2", null, "pagina-2"]);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM production")).rows[0].n,
    ).toBe(3);
    expect(
      (
        await db.query(
          "SELECT last_error, last_success_at FROM sync_state WHERE job = $1",
          [JOB_NAME],
        )
      ).rows,
    ).toEqual([{ last_error: null, last_success_at: expect.any(Date) }]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}, 30000);
