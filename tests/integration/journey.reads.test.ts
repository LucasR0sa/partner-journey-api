import request from "supertest";
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
import type { AttributionRow } from "../../src/modules/journey/journey.repository.js";
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

async function signup(
  code: string,
  signedUpAt = "2026-05-03T12:00:00Z",
  source?: string,
): Promise<number> {
  const email = `${code.toLowerCase()}@exemplo.com`;
  if (source) {
    const lead = await postSigned(app, "/webhooks/leads", {
      event_id: `lead-${code}`,
      source,
      campaign: `campanha-${source}`,
      occurred_at: "2026-04-01T10:00:00Z",
      contact: { email },
    });
    expect(lead.status).toBe(201);
  }
  const response = await postSigned(app, "/webhooks/signups", {
    event_id: `signup-${code}`,
    crm_code: code,
    name: `Parceiro ${code}`,
    email: email.toUpperCase(),
    signed_up_at: signedUpAt,
  });
  expect(response.status).toBe(201);
  return response.body.id as number;
}

async function contract(
  id: string,
  code: string,
  partnerId: number | null,
  cents: number,
  paidAt: string,
) {
  await db.query(
    `INSERT INTO production (crm_contract_id, partner_code, partner_id, amount_cents, paid_at)
    VALUES ($1, $2, $3, $4, $5)`,
    [id, code, partnerId, cents, paidAt],
  );
}

describe("GET /partners/:code/journey", () => {
  it("devolve jornada completa, produção histórica e datas ISO em um SELECT", async () => {
    const id = await signup("P0001", "2026-05-03T12:00:00Z", "meta_ads");
    await contract("CT-1", "P0001", id, 10000, "2026-05-01");
    await contract("CT-2", "P0001", id, 25000, "2026-05-31");
    await contract("CT-3", "P0001", id, 0, "2026-06-01");
    const query = vi.spyOn(db, "query");
    try {
      const response = await request(app).get("/partners/P0001/journey");
      expect(response.status).toBe(200);
      expect(query).toHaveBeenCalledTimes(1);
      expect(response.body).toEqual({
        crmCode: "P0001",
        name: "Parceiro P0001",
        lead: {
          source: "meta_ads",
          campaign: "campanha-meta_ads",
          occurredAt: "2026-04-01T10:00:00.000Z",
        },
        matchMethod: "email",
        signedUpAt: "2026-05-03T12:00:00.000Z",
        production: {
          totalCents: 35000,
          contracts: 3,
          firstPaidAt: "2026-05-01",
          lastPaidAt: "2026-06-01",
        },
      });
    } finally {
      query.mockRestore();
    }
  });

  it("preserva parceiro sem lead nem produção, com totais zero e datas nulas", async () => {
    await signup("P-empty");
    const response = await request(app).get("/partners/P-empty/journey");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      lead: null,
      matchMethod: "none",
      production: {
        totalCents: 0,
        contracts: 0,
        firstPaidAt: null,
        lastPaidAt: null,
      },
    });
  });

  it("responde 404 para código inexistente", async () => {
    const response = await request(app).get("/partners/inexistente/journey");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("partner_not_found");
  });

  it("responde 422 para código com mais de 50 caracteres", async () => {
    const response = await request(app).get(
      `/partners/${"x".repeat(51)}/journey`,
    );
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("validation_error");
  });
});

describe("GET /metrics/attribution", () => {
  it("fecha o mês no fuso de São Paulo, incluindo 31/10 às 22h em outubro", async () => {
    await signup("P-before", "2026-09-30T23:59:59.999-03:00");
    await signup("P-start", "2026-10-01T00:00:00-03:00");
    await signup("P-late", "2026-10-31T22:00:00-03:00");
    await signup("P-last", "2026-10-31T23:59:59.999-03:00");
    await signup("P-next", "2026-11-01T00:00:00-03:00");

    const october = await request(app)
      .get("/metrics/attribution")
      .query({ from: "2026-10-01", to: "2026-10-31" });
    expect(october.status).toBe(200);
    expect(october.body.rows).toEqual([
      {
        source: "sem_origem",
        newPartners: 3,
        producingPartners: 0,
        contracts: 0,
        totalCents: 0,
      },
    ]);
    expect(october.body.totals.newPartners).toBe(3);

    const november = await request(app)
      .get("/metrics/attribution")
      .query({ from: "2026-11-01", to: "2026-11-30" });
    expect(november.status).toBe(200);
    expect(november.body.totals.newPartners).toBe(1);
  });

  it("separa cadastro de produção e respeita as datas inclusivas do negócio em São Paulo", async () => {
    const oldMeta = await signup(
      "P-meta-old",
      "2026-04-20T12:00:00Z",
      "meta_ads",
    );
    await signup("P-meta-new", "2026-05-15T12:00:00Z", "meta_ads");
    const googleStart = await signup(
      "P-google-start",
      "2026-05-01T00:00:00-03:00",
      "google_ads",
    );
    const googleOld = await signup(
      "P-google-old",
      "2026-04-30T23:59:59.999-03:00",
      "google_ads",
    );
    const noOrigin = await signup("P-none", "2026-05-31T23:59:59.999-03:00");
    await signup("P-after", "2026-06-01T00:00:00-03:00");
    const organic = await signup(
      "P-organic",
      "2026-04-20T12:00:00Z",
      "organico",
    );
    await signup("P-new-only", "2026-05-05T12:00:00Z", "indicacao");
    await contract("meta-from", "P-meta-old", oldMeta, 10000, "2026-05-01");
    await contract("meta-to", "P-meta-old", oldMeta, 20000, "2026-05-31");
    await contract("meta-before", "P-meta-old", oldMeta, 99999, "2026-04-30");
    await contract("meta-after", "P-meta-old", oldMeta, 88888, "2026-06-01");
    await contract(
      "google-before-signup",
      "P-google-old",
      googleOld,
      5000,
      "2026-05-10",
    );
    await contract(
      "google-after",
      "P-google-start",
      googleStart,
      66666,
      "2026-06-01",
    );
    await contract("none-to", "P-none", noOrigin, 7000, "2026-05-31");
    await contract("organic", "P-organic", organic, 3000, "2026-05-15");
    await contract("unlinked", "P-unknown", null, 4000, "2026-05-10");
    await contract("unlinked-after", "P-unknown", null, 77777, "2026-06-01");

    const response = await request(app)
      .get("/metrics/attribution")
      .query({ from: "2026-05-01", to: "2026-05-31" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
      rows: [
        {
          source: "meta_ads",
          newPartners: 1,
          producingPartners: 1,
          contracts: 2,
          totalCents: 30000,
        },
        {
          source: "sem_origem",
          newPartners: 1,
          producingPartners: 1,
          contracts: 1,
          totalCents: 7000,
        },
        {
          source: "google_ads",
          newPartners: 1,
          producingPartners: 1,
          contracts: 1,
          totalCents: 5000,
        },
        {
          source: "sem_cadastro",
          newPartners: 0,
          producingPartners: 0,
          contracts: 1,
          totalCents: 4000,
        },
        {
          source: "organico",
          newPartners: 0,
          producingPartners: 1,
          contracts: 1,
          totalCents: 3000,
        },
        {
          source: "indicacao",
          newPartners: 1,
          producingPartners: 0,
          contracts: 0,
          totalCents: 0,
        },
      ],
      totals: {
        newPartners: 4,
        producingPartners: 4,
        contracts: 6,
        totalCents: 49000,
      },
    });
    for (const metric of [
      "newPartners",
      "producingPartners",
      "contracts",
      "totalCents",
    ] as const) {
      expect(response.body.totals[metric]).toBe(
        (response.body.rows as AttributionRow[]).reduce(
          (sum, row) => sum + row[metric],
          0,
        ),
      );
    }
  });

  it("aceita período inclusivo de 366 dias e devolve zeros quando não há atividade", async () => {
    const response = await request(app)
      .get("/metrics/attribution")
      .query({ from: "2024-01-01", to: "2024-12-31" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
      rows: [],
      totals: {
        newPartners: 0,
        producingPartners: 0,
        contracts: 0,
        totalCents: 0,
      },
    });
  });

  it("aceita um único dia e inclui contrato pago nesse dia", async () => {
    await contract("single-day", "P-unknown", null, 12345, "2026-05-31");
    const response = await request(app)
      .get("/metrics/attribution")
      .query({ from: "2026-05-31", to: "2026-05-31" });
    expect(response.status).toBe(200);
    expect(response.body.totals).toEqual({
      newPartners: 0,
      producingPartners: 0,
      contracts: 1,
      totalCents: 12345,
    });
  });

  it.each([
    { to: "2026-05-31" },
    { from: "2026-05-01" },
    { from: "2026-5-01", to: "2026-05-31" },
    { from: "2026-02-29", to: "2026-03-01" },
    { from: "2026-05-31", to: "2026-05-01" },
    { from: "2024-01-01", to: "2025-01-01" },
    { from: "2026-01-01", to: "2027-01-02" },
    { from: "2026-05-01T00:00:00Z", to: "2026-05-31" },
    { from: "0000-01-01", to: "0000-01-02" },
  ])("responde 422 para query inválida: %j", async (query) => {
    const response = await request(app)
      .get("/metrics/attribution")
      .query(query);
    expect(response.status).toBe(422);
    expect(response.body.error).toBe("validation_error");
  });

  it("recusa parâmetros repetidos em vez de escolher uma data silenciosamente", async () => {
    const response = await request(app).get(
      "/metrics/attribution?from=2026-05-01&from=2026-05-02&to=2026-05-31",
    );
    expect(response.status).toBe(422);
  });
});
