import { loadEnv } from "../config/env.js";
import { createPool } from "../db/pool.js";
import { createCrmClient } from "../modules/production/crm-client.js";
import { runProductionSync } from "../modules/production/sync.job.js";
import { createDiscordAlerter } from "../shared/alerts/discord.js";
import { logger } from "../shared/logger.js";

const env = loadEnv();
const db = createPool(env.DATABASE_URL);

try {
  await runProductionSync({
    full: process.argv.includes("--full"),
    db,
    crm: createCrmClient(env.CRM_BASE_URL),
    alerter: createDiscordAlerter(env.DISCORD_WEBHOOK_URL),
  });
} catch (err) {
  logger.error({ err }, "execução da sincronização encerrada com falha");
  process.exitCode = 1;
} finally {
  // Permite que o comando termine mesmo quando a sincronização falha.
  await db.end();
}
