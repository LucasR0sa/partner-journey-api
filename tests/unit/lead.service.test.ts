import { describe, expect, it } from "vitest";
import { createLeadService } from "../../src/modules/leads/lead.service.js";
import type { LeadRepository, NewLead } from "../../src/modules/leads/lead.repository.js";

// Repositório em memória: testa a regra de negócio sem subir banco.
function fakeRepo() {
  const saved = new Map<string, NewLead>();
  const repo: LeadRepository = {
    async insertIfNew(lead) {
      if (saved.has(lead.eventId)) return null;
      saved.set(lead.eventId, lead);
      return saved.size;
    },
  };
  return { repo, saved };
}

const base = { event_id: "evt-1", occurred_at: new Date("2026-10-01T12:00:00Z"), source: "Meta_Ads", contact: { email: " Ana@Exemplo.com " } };

describe("leadService.ingest", () => {
  it("normaliza contato e fonte antes de gravar", async () => {
    const { repo, saved } = fakeRepo();
    const result = await createLeadService(repo).ingest(base);
    expect(result).toEqual({ status: "created", leadId: 1 });
    expect(saved.get("evt-1")).toMatchObject({ emailNorm: "ana@exemplo.com", phoneNorm: null, source: "meta_ads" });
  });

  it("reenvio do mesmo evento vira duplicate", async () => {
    const { repo } = fakeRepo();
    const service = createLeadService(repo);
    await service.ingest(base);
    expect(await service.ingest(base)).toEqual({ status: "duplicate" });
  });

  it("recusa lead sem nenhum contato utilizável", async () => {
    const { repo } = fakeRepo();
    await expect(createLeadService(repo).ingest({ ...base, contact: { email: "invalido", phone: "12" } })).rejects.toMatchObject({ status: 422 });
  });
});
