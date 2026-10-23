import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Db } from "../../src/db/pool.js";
import { setupTestDb } from "../helpers/db.js";

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(() => db?.end());

it("migration 002 preserva produção existente, preenche código e permite vínculo tardio", async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Um schema isolado reproduz uma base antiga sem modificar o histórico público.
    await client.query("CREATE SCHEMA production_migration_002_test");
    await client.query(
      "SET LOCAL search_path TO production_migration_002_test",
    );
    await client.query(
      await readFile(
        new URL("../../src/db/migrations/001_init.sql", import.meta.url),
        "utf8",
      ),
    );
    const { rows: partners } =
      await client.query(`INSERT INTO partners (crm_code, name, signed_up_at)
      VALUES ('P-old', 'Parceiro existente', '2026-05-01') RETURNING id`);
    await client.query(
      `INSERT INTO production (crm_contract_id, partner_id, amount_cents, paid_at)
      VALUES ('CT-old', $1, 12345, '2026-05-02')`,
      [partners[0].id],
    );

    await client.query(
      await readFile(
        new URL(
          "../../src/db/migrations/002_production_unlinked_partner.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          "SELECT partner_code, partner_id, amount_cents FROM production",
        )
      ).rows,
    ).toEqual([
      {
        partner_code: "P-old",
        partner_id: partners[0].id,
        amount_cents: 12345,
      },
    ]);
    await client.query(`INSERT INTO production (crm_contract_id, partner_code, amount_cents, paid_at)
      VALUES ('CT-unlinked', 'P-late', 45678, '2026-05-03')`);
    expect(
      (
        await client.query(
          "SELECT partner_id FROM production WHERE crm_contract_id = 'CT-unlinked'",
        )
      ).rows,
    ).toEqual([{ partner_id: null }]);
    expect(
      (
        await client.query(`SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'production_migration_002_test' AND table_name = 'production'
        AND column_name IN ('partner_code', 'partner_id') ORDER BY column_name`)
      ).rows,
    ).toEqual([
      { column_name: "partner_code", is_nullable: "NO" },
      { column_name: "partner_id", is_nullable: "YES" },
    ]);
    const { rows: indexes } =
      await client.query(`SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'production_migration_002_test' AND tablename = 'production'`);
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexname: "production_partner_code_idx",
          indexdef: expect.stringContaining("(partner_code)"),
        }),
        expect.objectContaining({
          indexname: "production_unlinked_partner_code_idx",
          indexdef: expect.stringContaining("WHERE (partner_id IS NULL)"),
        }),
      ]),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
