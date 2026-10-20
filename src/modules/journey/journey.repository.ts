// ─────────────────────────────────────────────────────────────────────────────
// DIA 1 · BLOCO 4 — Leitura: jornada de um parceiro e atribuição por canal
// ─────────────────────────────────────────────────────────────────────────────
import type { Db } from "../../db/pool.js";

export interface PartnerJourney {
  crmCode: string;
  name: string;
  lead: { source: string; campaign: string | null; occurredAt: string } | null;
  matchMethod: "email" | "phone" | "none" | null;
  signedUpAt: string;
  production: { totalCents: number; contracts: number; firstPaidAt: string | null; lastPaidAt: string | null };
}

export interface AttributionRow {
  source: string; // "sem_origem" para parceiros sem lead
  partners: number;
  producingPartners: number;
  totalCents: number;
}

export function createJourneyRepository(_db: Db) {
  return {
    /** GET /partners/:code/journey — um SELECT com LEFT JOIN leads + agregação em production. */
    async findJourney(_crmCode: string): Promise<PartnerJourney | null> {
      throw new Error("findJourney: não implementado (dia 1 · bloco 4)");
    },
    /** GET /metrics/attribution?from=&to= — agrupa por leads.source (COALESCE para "sem_origem"). */
    async attribution(_from: Date, _to: Date): Promise<AttributionRow[]> {
      throw new Error("attribution: não implementado (dia 1 · bloco 4)");
    },
  };
}
