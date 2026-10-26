import { Router } from "express";
import { attributionQuerySchema, partnerCodeSchema } from "./journey.schema.js";
import type { JourneyService } from "./journey.service.js";

export function journeyRoutes(service: JourneyService): Router {
  const router = Router();

  router.get("/partners/:code/journey", async (req, res) => {
    const code = partnerCodeSchema.parse(req.params.code);
    res.json(await service.findJourney(code));
  });

  router.get("/metrics/attribution", async (req, res) => {
    const { from, to } = attributionQuerySchema.parse(req.query);
    res.json(await service.attribution(from, to));
  });

  return router;
}
