// Popula a API com leads fictícios, enviando webhooks assinados de verdade.
// Uso: npm run seed  (com a API rodando)
import { sign } from "../src/shared/security/hmac.js";

const API = process.env.API_URL ?? "http://localhost:3000";
const SECRET = process.env.WEBHOOK_SECRET ?? "troque-este-segredo";
const sources = ["meta_ads", "google_ads", "organico", "indicacao"];
const nomes = ["ana", "bruno", "carla", "davi", "elisa", "fabio", "gabi", "heitor"];

let created = 0;
for (let i = 1; i <= 300; i++) {
  const nome = nomes[i % nomes.length];
  const body = JSON.stringify({
    event_id: `seed-lead-${i}`,
    occurred_at: new Date(Date.UTC(2026, 3, 1) + i * 12 * 3_600_000).toISOString(),
    source: sources[i % sources.length],
    campaign: `campanha-${1 + (i % 5)}`,
    contact: { email: `${nome}.${i}@exemplo.com`, phone: `(48) 9${String(80000000 + i).padStart(8, "0")}` },
  });
  const res = await fetch(`${API}/webhooks/leads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": `sha256=${sign(body, SECRET)}` },
    body,
  });
  if (res.status === 201) created++;
  else if (res.status !== 200) throw new Error(`seed falhou no lead ${i}: ${res.status} ${await res.text()}`);
}
console.log(`${created} leads criados (os demais já existiam).`);
// TODO(bloco 2): enviar também cadastros para /webhooks/signups, parte com e-mail igual ao lead.
