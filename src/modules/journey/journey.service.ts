import { HttpError } from "../../shared/http/errors.js";
import type {
  AttributionRow,
  JourneyRepository,
} from "./journey.repository.js";

export type AttributionTotals = Omit<AttributionRow, "source">;

export function createJourneyService(repo: JourneyRepository) {
  return {
    async findJourney(crmCode: string) {
      const journey = await repo.findJourney(crmCode);
      if (!journey)
        throw new HttpError(
          404,
          "parceiro não encontrado",
          "partner_not_found",
        );
      return journey;
    },

    async attribution(from: string, to: string) {
      const rows = await repo.attribution(from, to);
      const totals = rows.reduce<AttributionTotals>(
        (sum, row) => ({
          newPartners: sum.newPartners + row.newPartners,
          producingPartners: sum.producingPartners + row.producingPartners,
          contracts: sum.contracts + row.contracts,
          totalCents: sum.totalCents + row.totalCents,
        }),
        { newPartners: 0, producingPartners: 0, contracts: 0, totalCents: 0 },
      );
      return { from, to, rows, totals };
    },
  };
}

export type JourneyService = ReturnType<typeof createJourneyService>;
