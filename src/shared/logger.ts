import { pino } from "pino";

// Log estruturado em JSON: em produção vai para o agregador (Loki, Datadog...)
// e dá para filtrar por campo (ex.: event_id) em vez de procurar texto.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers['x-signature']", "*.email", "*.phone"],
});
