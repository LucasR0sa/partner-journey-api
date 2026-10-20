import { z } from "zod";

// Valida as variáveis de ambiente na subida: se faltar algo, a API nem sobe
// (falhar cedo é melhor do que descobrir em produção, no meio de uma requisição).
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  WEBHOOK_SECRET: z.string().min(16, "WEBHOOK_SECRET precisa ter pelo menos 16 caracteres"),
  CRM_BASE_URL: z.string().url().default("http://localhost:4000"),
  DISCORD_WEBHOOK_URL: z.union([z.string().url(), z.literal("")]).default(""),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${problems}`);
  }
  return parsed.data;
}
