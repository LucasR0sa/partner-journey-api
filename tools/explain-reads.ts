// Mede as mesmas queries do repository, sem copiar SQL nem alterar os dados.
import { loadEnv } from "../src/config/env.js";
import { createPool } from "../src/db/pool.js";
import {
  ATTRIBUTION_SQL,
  FIND_JOURNEY_SQL,
} from "../src/modules/journey/journey.repository.js";
import {
  attributionQuerySchema,
  partnerCodeSchema,
} from "../src/modules/journey/journey.schema.js";

const [rawCode = "P0001", rawFrom = "2026-05-01", rawTo = rawFrom] =
  process.argv.slice(2);
const code = partnerCodeSchema.parse(rawCode);
const { from, to } = attributionQuerySchema.parse({ from: rawFrom, to: rawTo });
const db = createPool(loadEnv().DATABASE_URL);
try {
  for (const query of [
    { name: "Jornada", sql: FIND_JOURNEY_SQL, values: [code] },
    { name: "Atribuição", sql: ATTRIBUTION_SQL, values: [from, to] },
  ]) {
    console.log(query.name);
    const { rows } = await db.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS) ${query.sql}`,
      query.values,
    );
    for (const row of rows) console.log(row["QUERY PLAN"]);
  }
} finally {
  await db.end();
}
