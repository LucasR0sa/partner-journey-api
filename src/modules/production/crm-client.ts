import { z } from "zod";

// Cliente do CRM (no projeto, o CRM é falso: tools/fake-crm.ts). Ele devolve contratos
// paginados por cursor e, de propósito, às vezes falha com 503 — como APIs reais.
const pageSchema = z.object({
  data: z.array(
    z.object({
      contract_id: z.string(),
      partner_code: z.string(),
      amount_cents: z.number().int().nonnegative(),
      paid_at: z.string(),
    }),
  ),
  next_cursor: z.string().nullable(),
});

export type CrmPage = z.infer<typeof pageSchema>;

export class CrmHttpError extends Error {
  constructor(public readonly status: number) {
    super(`CRM respondeu ${status}`);
  }
  /** 5xx e 429 são temporários: vale tentar de novo. 4xx não. */
  get retryable() {
    return this.status >= 500 || this.status === 429;
  }
}

export function createCrmClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  return {
    async fetchContracts(cursor: string | null, limit = 100): Promise<CrmPage> {
      const url = new URL("/contracts", baseUrl);
      if (cursor) url.searchParams.set("cursor", cursor);
      url.searchParams.set("limit", String(limit));
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new CrmHttpError(res.status);
      return pageSchema.parse(await res.json());
    },
  };
}

export type CrmClient = ReturnType<typeof createCrmClient>;
