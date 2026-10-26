import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import type { Db } from "../../src/db/pool.js";
import { runProductionSync } from "../../src/modules/production/sync.job.js";
import { resetDb, setupTestDb } from "../helpers/db.js";
import { postSigned } from "../helpers/webhook.js";

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => db?.end());

it("contrato transferido não herda vínculo antigo e vincula ao novo parceiro no cadastro", async () => {
  const app = createApp({
    db,
    env: { WEBHOOK_SECRET: process.env.WEBHOOK_SECRET! },
  });
  const signup = (code: string) =>
    postSigned(app, "/webhooks/signups", {
      event_id: `signup-${code}`,
      crm_code: code,
      name: `Parceiro ${code}`,
      signed_up_at: "2026-05-01T12:00:00Z",
    });
  const first = await signup("P0001");
  expect(first.status).toBe(201);
  let contract = {
    contract_id: "CT-transfer",
    partner_code: "P0001",
    amount_cents: 10000,
    paid_at: "2026-05-02",
  };
  const deps = {
    db,
    crm: {
      fetchContracts: async () => ({ data: [contract], next_cursor: null }),
    },
    alerter: { notify: async () => {} },
  };
  await runProductionSync(deps);
  expect((await db.query("SELECT partner_id FROM production")).rows).toEqual([
    { partner_id: first.body.id },
  ]);

  contract = { ...contract, partner_code: "P0002" };
  const transferred = await runProductionSync(deps);
  expect(
    (await db.query("SELECT partner_code, partner_id FROM production")).rows,
  ).toEqual([{ partner_code: "P0002", partner_id: null }]);
  expect(transferred).toEqual({
    pages: 1,
    upserted: 1,
    unlinked: 1,
    relinked: 0,
  });

  const second = await signup("P0002");
  expect(second.status).toBe(201);
  expect(second.body.id).not.toBe(first.body.id);
  expect(
    (
      await db.query(
        "SELECT crm_contract_id, partner_code, partner_id, amount_cents FROM production",
      )
    ).rows,
  ).toEqual([
    {
      crm_contract_id: "CT-transfer",
      partner_code: "P0002",
      partner_id: second.body.id,
      amount_cents: 10000,
    },
  ]);
});
