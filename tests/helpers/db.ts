import { createPool, type Db } from "../../src/db/pool.js";
import { migrate } from "../../src/db/migrate.js";

export async function setupTestDb(): Promise<Db> {
  const db = createPool(process.env.DATABASE_URL!);
  await migrate(db);
  return db;
}

export async function resetDb(db: Db) {
  await db.query("TRUNCATE production, partners, leads, sync_state RESTART IDENTITY CASCADE");
}
