import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import type { Db } from "../../src/db/pool.js";
import { resetDb, setupTestDb } from "../helpers/db.js";
import { postSigned } from "../helpers/webhook.js";

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await setupTestDb();
  app = createApp({ db, env: { WEBHOOK_SECRET: process.env.WEBHOOK_SECRET! } });
});
beforeEach(() => resetDb(db));
afterAll(() => db?.end());

const payload = (overrides: Record<string, unknown> = {}) => ({
  event_id: "crm-cadastro-001",
  crm_code: "P0001",
  name: "Ana Silva",
  email: " Ana@Exemplo.com ",
  phone: "+55 (48) 99999-1234",
  signed_up_at: "2026-10-10T12:00:00Z",
  ...overrides,
});

async function createLead(
  eventId = "lead-cadastro-001",
  contact: { email?: string; phone?: string } = {
    email: "Ana@Exemplo.com",
    phone: "(48) 99999-1234",
  },
): Promise<number> {
  const res = await postSigned(app, "/webhooks/leads", {
    event_id: eventId,
    occurred_at: "2026-10-01T12:00:00Z",
    source: "meta_ads",
    contact,
  });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("POST /webhooks/signups", () => {
  it("cria o parceiro e liga ao lead pelo e-mail", async () => {
    const leadId = await createLead();
    const res = await postSigned(app, "/webhooks/signups", payload());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      status: "created",
      leadId,
      matchMethod: "email",
    });
    const { rows } = await db.query(
      "SELECT crm_code, name, email_norm, phone_norm, lead_id, match_method, signed_up_at FROM partners",
    );
    expect(rows).toEqual([
      {
        crm_code: "P0001",
        name: "Ana Silva",
        email_norm: "ana@exemplo.com",
        phone_norm: "48999991234",
        lead_id: leadId,
        match_method: "email",
        signed_up_at: new Date("2026-10-10T12:00:00Z"),
      },
    ]);
  });

  it("liga pelo telefone quando o e-mail não bate", async () => {
    const leadId = await createLead();
    const res = await postSigned(
      app,
      "/webhooks/signups",
      payload({ email: "outra@exemplo.com" }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ leadId, matchMethod: "phone" });
    expect(
      (await db.query("SELECT lead_id, match_method FROM partners")).rows,
    ).toEqual([{ lead_id: leadId, match_method: "phone" }]);
  });

  it("reenvia sem duplicar e atualiza todos os dados pelo código do CRM", async () => {
    await createLead();
    const original = payload();
    const first = await postSigned(app, "/webhooks/signups", original);
    const replay = await postSigned(app, "/webhooks/signups", original);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ...first.body, status: "updated" });

    const newLeadId = await createLead("lead-cadastro-002", {
      email: "outro@exemplo.com",
      phone: "(11) 99888-7766",
    });
    const updated = await postSigned(
      app,
      "/webhooks/signups",
      payload({
        event_id: "crm-cadastro-002",
        name: "Ana Atualizada",
        email: " Nova@Exemplo.com ",
        phone: "+55 (11) 99888-7766",
        signed_up_at: "2026-10-12T15:00:00Z",
      }),
    );

    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({
      id: first.body.id,
      status: "updated",
      leadId: newLeadId,
      matchMethod: "phone",
    });
    const { rows } = await db.query(
      "SELECT id, crm_code, name, email_norm, phone_norm, lead_id, match_method, signed_up_at FROM partners",
    );
    expect(rows).toEqual([
      {
        id: first.body.id,
        crm_code: "P0001",
        name: "Ana Atualizada",
        email_norm: "nova@exemplo.com",
        phone_norm: "11998887766",
        lead_id: newLeadId,
        match_method: "phone",
        signed_up_at: new Date("2026-10-12T15:00:00Z"),
      },
    ]);
  });

  it("cadastro sem lead fica com match_method none e lead_id null", async () => {
    const res = await postSigned(app, "/webhooks/signups", payload());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ leadId: null, matchMethod: "none" });
    expect(
      (await db.query("SELECT lead_id, match_method FROM partners")).rows,
    ).toEqual([{ lead_id: null, match_method: "none" }]);
  });

  it("aceita cadastro sem e-mail e sem telefone, sem atribuir origem", async () => {
    const res = await postSigned(
      app,
      "/webhooks/signups",
      payload({ email: undefined, phone: undefined }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ leadId: null, matchMethod: "none" });
    const { rows } = await db.query(
      "SELECT email_norm, phone_norm, lead_id, match_method FROM partners",
    );
    expect(rows).toEqual([
      {
        email_norm: null,
        phone_norm: null,
        lead_id: null,
        match_method: "none",
      },
    ]);
  });

  it("recusa assinatura inválida com 401 e não grava nada", async () => {
    const res = await postSigned(
      app,
      "/webhooks/signups",
      payload(),
      "segredo-errado-de-algum-atacante",
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_signature");
    expect(
      (await db.query("SELECT count(*)::int AS n FROM partners")).rows[0].n,
    ).toBe(0);
  });

  it("recusa corpo inválido com 422 e lista os campos", async () => {
    const res = await postSigned(
      app,
      "/webhooks/signups",
      payload({ name: "" }),
    );

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "name" })]),
    );
    expect(
      (await db.query("SELECT count(*)::int AS n FROM partners")).rows[0].n,
    ).toBe(0);
  });

  it("mantém um parceiro quando o mesmo cadastro chega dez vezes em paralelo", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postSigned(app, "/webhooks/signups", payload()),
      ),
    );

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 200)).toHaveLength(9);
    expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
    expect(
      (await db.query("SELECT count(*)::int AS n FROM partners")).rows[0].n,
    ).toBe(1);
  });
});
