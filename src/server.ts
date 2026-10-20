import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { logger } from "./shared/logger.js";

const env = loadEnv();
const db = createPool(env.DATABASE_URL);
await migrate(db);

const server = createApp({ db, env }).listen(env.PORT, () => logger.info({ port: env.PORT }, "API no ar"));

// Desligamento gracioso: para de aceitar conexões, termina as requisições em andamento
// e só então fecha o pool. Evita erro 502 a cada deploy.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "encerrando");
    server.close(() => db.end().then(() => process.exit(0)));
  });
}
