import { Router, type Request } from "express";
import { HttpError } from "../../shared/http/errors.js";
import { verifySignature } from "../../shared/security/hmac.js";
import { leadWebhookSchema } from "./lead.schema.js";
import type { LeadService } from "./lead.service.js";

export function leadRoutes(service: LeadService, webhookSecret: string): Router {
  const router = Router();

  // POST /webhooks/leads
  // 1. confere a assinatura  2. valida o corpo  3. grava de forma idempotente
  router.post("/webhooks/leads", async (req: Request & { rawBody?: Buffer }, res) => {
    if (!verifySignature(req.rawBody ?? Buffer.alloc(0), req.header("x-signature"), webhookSecret)) {
      throw new HttpError(401, "assinatura inválida", "invalid_signature");
    }
    const payload = leadWebhookSchema.parse(req.body);
    const result = await service.ingest(payload);

    // 201 na primeira vez, 200 no reenvio: o provedor para de tentar nos dois casos.
    if (result.status === "created") res.status(201).json({ id: result.leadId, status: "created" });
    else res.status(200).json({ status: "duplicate" });
  });

  return router;
}
