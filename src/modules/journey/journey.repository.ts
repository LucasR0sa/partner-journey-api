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
  production: {
    totalCents: number;
    contracts: number;
    firstPaidAt: string | null;
    lastPaidAt: string | null;
  };
}

export interface AttributionRow {
  // Fonte do lead; sem_origem para cadastro sem lead; sem_cadastro para produção sem vínculo.
  source: string;
  // Cadastros com signed_up_at no período, independentemente de terem produção.
  newPartners: number;
  // Parceiros distintos com paid_at no período, mesmo cadastrados antes; sem_cadastro conta zero.
  producingPartners: number;
  // Contratos pagos no período e sua soma em centavos, inclusive os sem cadastro.
  contracts: number;
  totalCents: number;
}

// LATERAL agrega somente a produção deste parceiro e devolve uma linha, mesmo sem contratos.
export const FIND_JOURNEY_SQL = `
  SELECT p.crm_code, p.name, p.match_method, p.signed_up_at,
    l.source AS lead_source, l.campaign AS lead_campaign, l.occurred_at AS lead_occurred_at,
    totals.total_cents, totals.contracts, totals.first_paid_at, totals.last_paid_at
  FROM partners AS p
  LEFT JOIN leads AS l ON l.id = p.lead_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(pr.amount_cents), 0) AS total_cents, COUNT(*) AS contracts,
      to_char(MIN(pr.paid_at), 'YYYY-MM-DD') AS first_paid_at,
      to_char(MAX(pr.paid_at), 'YYYY-MM-DD') AS last_paid_at
    FROM production AS pr WHERE pr.partner_id = p.id
  ) AS totals ON true
  WHERE p.crm_code = $1`;

// As duas métricas têm datas diferentes; agregá-las separadamente evita multiplicar cadastros.
export const ATTRIBUTION_SQL = `
  WITH new_partners AS (
    SELECT COALESCE(l.source, 'sem_origem') AS source, COUNT(*) AS new_partners
    FROM partners AS p
    LEFT JOIN leads AS l ON l.id = p.lead_id
    WHERE p.signed_up_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND p.signed_up_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    GROUP BY 1
  ), paid_production AS (
    SELECT CASE WHEN pr.partner_id IS NULL THEN 'sem_cadastro'
      ELSE COALESCE(l.source, 'sem_origem') END AS source,
      COUNT(DISTINCT p.id) AS producing_partners,
      COUNT(*) AS contracts, SUM(pr.amount_cents) AS total_cents
    FROM production AS pr
    LEFT JOIN partners AS p ON p.id = pr.partner_id
    LEFT JOIN leads AS l ON l.id = p.lead_id
    WHERE pr.paid_at >= $1::date AND pr.paid_at <= $2::date
    GROUP BY 1
  )
  SELECT COALESCE(n.source, paid.source) AS source,
    COALESCE(n.new_partners, 0) AS new_partners,
    COALESCE(paid.producing_partners, 0) AS producing_partners,
    COALESCE(paid.contracts, 0) AS contracts,
    COALESCE(paid.total_cents, 0) AS total_cents
  FROM new_partners AS n
  FULL JOIN paid_production AS paid ON paid.source = n.source
  ORDER BY total_cents DESC, source ASC`;

interface JourneyRow {
  crm_code: string;
  name: string;
  match_method: PartnerJourney["matchMethod"];
  signed_up_at: Date;
  lead_source: string | null;
  lead_campaign: string | null;
  lead_occurred_at: Date | null;
  total_cents: string | number;
  contracts: string | number;
  first_paid_at: string | null;
  last_paid_at: string | null;
}

export interface JourneyRepository {
  findJourney(crmCode: string): Promise<PartnerJourney | null>;
  attribution(from: string, to: string): Promise<AttributionRow[]>;
}

export function createJourneyRepository(db: Db): JourneyRepository {
  return {
    /** GET /partners/:code/journey — um SELECT com LEFT JOIN leads + agregação em production. */
    async findJourney(crmCode) {
      const { rows } = await db.query<JourneyRow>(FIND_JOURNEY_SQL, [crmCode]);
      const row = rows[0];
      if (!row) return null;
      return {
        crmCode: row.crm_code,
        name: row.name,
        lead:
          row.lead_source !== null && row.lead_occurred_at !== null
            ? {
                source: row.lead_source,
                campaign: row.lead_campaign,
                occurredAt: row.lead_occurred_at.toISOString(),
              }
            : null,
        matchMethod: row.match_method,
        signedUpAt: row.signed_up_at.toISOString(),
        production: {
          totalCents: Number(row.total_cents),
          contracts: Number(row.contracts),
          firstPaidAt: row.first_paid_at,
          lastPaidAt: row.last_paid_at,
        },
      };
    },
    /** GET /metrics/attribution?from=&to= — agrupa por leads.source (COALESCE para "sem_origem"). */
    async attribution(from, to) {
      const { rows } = await db.query<{
        source: string;
        new_partners: string | number;
        producing_partners: string | number;
        contracts: string | number;
        total_cents: string | number;
      }>(ATTRIBUTION_SQL, [from, to]);
      return rows.map((row) => ({
        source: row.source,
        newPartners: Number(row.new_partners),
        producingPartners: Number(row.producing_partners),
        contracts: Number(row.contracts),
        totalCents: Number(row.total_cents),
      }));
    },
  };
}
