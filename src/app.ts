import express, { type Request } from "express";
import type { Db } from "./db/pool.js";
import type { Env } from "./config/env.js";
import { errorHandler } from "./shared/http/errors.js";
import { createLeadRepository } from "./modules/leads/lead.repository.js";
import { createLeadService } from "./modules/leads/lead.service.js";
import { leadRoutes } from "./modules/leads/lead.routes.js";
import { createSignupRepository } from "./modules/signups/signup.repository.js";
import { createSignupService } from "./modules/signups/signup.service.js";
import { signupRoutes } from "./modules/signups/signup.routes.js";

// createApp recebe as dependências por parâmetro (injeção de dependência simples):
// nos testes passamos um banco de teste; em produção, o pool real.
export function createApp(deps: { db: Db; env: Pick<Env, "WEBHOOK_SECRET"> }) {
  const app = express();
  app.disable("x-powered-by");

  // Guarda o corpo bruto: a assinatura HMAC é calculada sobre os bytes exatos recebidos,
  // não sobre o JSON re-serializado (que pode mudar espaços e ordem das chaves).
  app.use(
    express.json({
      limit: "100kb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.get("/health", async (_req, res) => {
    await deps.db.query("SELECT 1");
    res.json({ status: "ok" });
  });

  app.use(
    leadRoutes(
      createLeadService(createLeadRepository(deps.db)),
      deps.env.WEBHOOK_SECRET,
    ),
  );

  app.use(
    signupRoutes(
      createSignupService(createSignupRepository(deps.db)),
      deps.env.WEBHOOK_SECRET,
    ),
  );
  // TODO(dia 1 · bloco 4): app.use(journeyRoutes(...))  → GET /partners/:code/journey e GET /metrics/attribution

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(errorHandler);
  return app;
}
