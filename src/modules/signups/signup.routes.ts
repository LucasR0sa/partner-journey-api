import { Router, type Request } from "express";
import { HttpError } from "../../shared/http/errors.js";
import { verifySignature } from "../../shared/security/hmac.js";
import { signupWebhookSchema } from "./signup.schema.js";
import type { SignupService } from "./signup.service.js";

export function signupRoutes(
  service: SignupService,
  webhookSecret: string,
): Router {
  const router = Router();

  router.post(
    "/webhooks/signups",
    async (req: Request & { rawBody?: Buffer }, res) => {
      // Autentica os bytes recebidos antes de validar ou gravar o cadastro.
      if (
        !verifySignature(
          req.rawBody ?? Buffer.alloc(0),
          req.header("x-signature"),
          webhookSecret,
        )
      ) {
        throw new HttpError(401, "assinatura inválida", "invalid_signature");
      }
      const payload = signupWebhookSchema.parse(req.body);
      const result = await service.ingest(payload);

      res.status(result.status === "created" ? 201 : 200).json({
        id: result.partnerId,
        status: result.status,
        leadId: result.leadId,
        matchMethod: result.matchMethod,
      });
    },
  );

  return router;
}
