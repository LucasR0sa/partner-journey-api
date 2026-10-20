# ADR 0001 — Webhooks idempotentes com chave no banco

**Status:** aceito

## Contexto
Provedores de webhook garantem entrega "pelo menos uma vez": se a nossa resposta demora ou a rede cai,
o mesmo evento chega de novo. Na prática isso inflava a contagem de leads e, por consequência, o CAC.

## Decisão
- Cada evento traz um `event_id`. A tabela `leads` tem `UNIQUE(event_id)` e o insert usa
  `ON CONFLICT (event_id) DO NOTHING RETURNING id`.
- Primeira entrega → `201`. Reenvio → `200 {"status":"duplicate"}`. Os dois param o retry do provedor.
- O corpo é autenticado com **HMAC-SHA256** sobre os bytes brutos, comparado com `timingSafeEqual`.

## Por que no banco e não em memória/Redis
Com duas réplicas da API, um "já vi esse id?" em memória falha: as duas veem "não" ao mesmo tempo.
A constraint resolve a corrida no lugar certo. Há teste de integração que dispara o mesmo evento
10 vezes em paralelo e confere que só uma linha existe.

## Consequências
- (+) Correto sob concorrência, sem infraestrutura extra.
- (−) Eventos sem `event_id` estável não são suportados (o provedor precisa enviar um).
