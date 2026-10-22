// Popula a API com leads e cadastros fictícios, usando webhooks assinados.
// Uso: npm run seed  (com a API rodando)
import { sign } from "../src/shared/security/hmac.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const SECRET = process.env.WEBHOOK_SECRET ?? "troque-este-segredo";
const sources = ["meta_ads", "google_ads", "organico", "indicacao"];
const nomes = [
  "ana",
  "bruno",
  "carla",
  "davi",
  "elisa",
  "fabio",
  "gabi",
  "heitor",
];

const leads = Array.from({ length: 300 }, (_, index) => {
  const i = index + 1;
  const nome = nomes[i % nomes.length];
  return {
    event_id: `seed-lead-${i}`,
    occurred_at: new Date(
      Date.UTC(2026, 3, 1) + i * 12 * 3_600_000,
    ).toISOString(),
    source: sources[i % sources.length],
    campaign: `campanha-${1 + (i % 5)}`,
    contact: {
      email: `${nome}.${i}@exemplo.com`,
      phone: `(48) 9${String(80000000 + i).padStart(8, "0")}`,
    },
  };
});

async function postWebhook(path: string, payload: unknown): Promise<number> {
  const body = JSON.stringify(payload);
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": `sha256=${sign(body, SECRET)}`,
    },
    body,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `seed falhou em ${path}: ${res.status} ${await res.text()}`,
    );
  }
  return res.status;
}

let leadsCreated = 0;
for (const lead of leads) {
  if ((await postWebhook("/webhooks/leads", lead)) === 201) leadsCreated++;
}
console.log(`${leadsCreated} leads criados (os demais já existiam).`);

let partnersCreated = 0;
let partnersUpdated = 0;
for (let i = 1; i <= 150; i++) {
  const lead = leads[i - 1]!;
  // Grupos de 50 tornam a demonstração de cada método de atribuição reproduzível.
  const status = await postWebhook("/webhooks/signups", {
    event_id: `seed-signup-${i}`,
    crm_code: `P${String(i).padStart(4, "0")}`,
    name: `Parceiro ${i}`,
    email: i <= 50 ? lead.contact.email : `cadastro.${i}@exemplo.com`,
    phone:
      i <= 100
        ? lead.contact.phone
        : `(11) 9${String(70000000 + i).padStart(8, "0")}`,
    signed_up_at: new Date(
      new Date(lead.occurred_at).getTime() + 7 * 86_400_000,
    ).toISOString(),
  });
  if (status === 201) partnersCreated++;
  else partnersUpdated++;
}
console.log(
  `${partnersCreated} parceiros criados e ${partnersUpdated} atualizados.`,
);
