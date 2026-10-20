import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { Db } from "../../src/db/pool.js";
import { resetDb, setupTestDb } from "../helpers/db.js";
import { postSigned } from "../helpers/webhook.js";

// Teste de integração: Express + Postgres de verdade. Pega erro de SQL, constraint e índice
// que um teste com mock nunca pegaria.
let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await setupTestDb();
  app = createApp({ db, env: { WEBHOOK_SECRET: process.env.WEBHOOK_SECRET! } });
});
beforeEach(() => resetDb(db));
afterAll(() => db.end());

const payload = (eventId = "rd-evt-001") => ({
  event_id: eventId,
  occurred_at: "2026-10-01T12:00:00Z",
  source: "meta_ads",
  campaign: "credito-parceiros-out",
  contact: { email: "Ana@Exemplo.com", phone: "(48) 99999-1234" },
});

describe("POST /webhooks/leads", () => {
  it("grava o lead normalizado e responde 201", async () => {
    const res = await postSigned(app, "/webhooks/leads", payload());
    expect(res.status).toBe(201);
    const { rows } = await db.query("SELECT email_norm, phone_norm, source FROM leads");
    expect(rows).toEqual([{ email_norm: "ana@exemplo.com", phone_norm: "48999991234", source: "meta_ads" }]);
  });

  it("é idempotente: o reenvio responde 200 e não duplica", async () => {
    await postSigned(app, "/webhooks/leads", payload());
    const res = await postSigned(app, "/webhooks/leads", payload());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "duplicate" });
    expect((await db.query("SELECT count(*)::int AS n FROM leads")).rows[0].n).toBe(1);
  });

  it("aguenta o mesmo evento chegando 10 vezes ao mesmo tempo", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => postSigned(app, "/webhooks/leads", payload("rd-evt-race"))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int AS n FROM leads")).rows[0].n).toBe(1);
  });

  it("recusa assinatura inválida com 401 e não grava nada", async () => {
    const res = await postSigned(app, "/webhooks/leads", payload(), "segredo-errado-de-algum-atacante");
    expect(res.status).toBe(401);
    expect((await db.query("SELECT count(*)::int AS n FROM leads")).rows[0].n).toBe(0);
  });

  it("recusa corpo inválido com 422 e lista os campos", async () => {
    const res = await postSigned(app, "/webhooks/leads", { event_id: "x", source: "meta_ads", contact: {} });
    expect(res.status).toBe(422);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["occurred_at"]));
  });

  it("recusa JSON quebrado com 400", async () => {
    const res = await request(app).post("/webhooks/leads").set("content-type", "application/json").send("{quebrado");
    expect(res.status).toBe(400);
  });
});

describe("GET /health", () => {
  it("responde ok com o banco no ar", async () => {
    expect((await request(app).get("/health")).body).toEqual({ status: "ok" });
  });
});
