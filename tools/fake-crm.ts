// CRM falso para desenvolvimento: devolve contratos paginados por cursor e falha de propósito
// (FAIL_RATE, padrão 15%) com 503 — para o job de sincronização ter o que tratar.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4000);
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.15);
const PARTNERS = Number(process.env.PARTNERS ?? 200);

// Gerador pseudoaleatório com semente fixa: os mesmos dados toda vez (reprodutível).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const contracts = Array.from({ length: 2_000 }, (_, i) => {
  const day = 1 + Math.floor(rnd() * 180);
  const paid = new Date(Date.UTC(2026, 3, 1) + day * 86_400_000);
  return {
    contract_id: `CT-${String(i + 1).padStart(6, "0")}`,
    partner_code: `P${String(1 + Math.floor(rnd() * PARTNERS)).padStart(4, "0")}`,
    amount_cents: Math.round(500_00 + rnd() * 20_000_00),
    paid_at: paid.toISOString().slice(0, 10),
  };
});

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/health") return void res.end("ok");
  if (url.pathname !== "/contracts") return void res.writeHead(404).end();
  if (Math.random() < FAIL_RATE) return void res.writeHead(503, { "retry-after": "1" }).end('{"error":"temporarily_unavailable"}');

  const start = Number(url.searchParams.get("cursor") ?? 0);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 100));
  const data = contracts.slice(start, start + limit);
  const next = start + limit < contracts.length ? String(start + limit) : null;
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data, next_cursor: next }));
}).listen(PORT, () => console.log(`fake-crm em http://localhost:${PORT} (falha ${FAIL_RATE * 100}%)`));
