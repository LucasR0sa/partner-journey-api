import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Db } from "./pool.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

// Runner de migrations mínimo: aplica cada .sql uma única vez, em ordem, dentro de transação.
// Em projeto maior eu usaria uma ferramenta pronta; aqui ele mostra o que essas ferramentas fazem.
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Falha na migration ${file}: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  return applied;
}

// Execução direta: npm run migrate
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadEnv } = await import("../config/env.js");
  const { createPool } = await import("./pool.js");
  const db = createPool(loadEnv().DATABASE_URL);
  const applied = await migrate(db);
  console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Nada a aplicar.");
  await db.end();
}
