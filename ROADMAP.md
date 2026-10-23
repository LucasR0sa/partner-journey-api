# Roteiro de 1 dia (≈ 8h)

O esqueleto já vem com: Docker, CI, migrations, testes, o **fluxo completo de leads** (para servir de modelo)
e as funções de apoio (`normalize`, `hmac`, `withRetry`, alerta do Discord). Você implementa o resto.

> Regra do dia: **teste primeiro**. Cada bloco termina com `npm test` verde e um commit.

## Bloco 0 — Preparar (30 min)

- [ ] `cp .env.example .env` e `docker compose up -d db fake-crm`
- [ ] `npm ci && npm run migrate && npm test` (tudo verde, 4 skipped e 12 todo)
- [ ] Ler `docs/architecture.md` e os 3 ADRs
- [ ] Ler o módulo `src/modules/leads` de ponta a ponta: é o padrão a copiar

## Bloco 1 — Entender o fluxo pronto (45 min)

- [ ] `npm run dev` e `npm run seed` (rodar 2x e ver que não duplica)
- [ ] Mandar um webhook com assinatura errada e ver o 401
- [ ] Explicar em voz alta, sem olhar: por que `ON CONFLICT` e não um `SELECT` antes do `INSERT`?

## Bloco 2 — Cadastro + matching (2h) · ADR 0002

- [x] Implementar `pickOriginLead` e tirar o `.skip` de `tests/unit/match.test.ts`
- [x] `signup.repository.ts`: buscar candidatos (mesmo e-mail **ou** telefone) e UPSERT em `partners`
- [x] `createSignupService` + `signup.routes.ts` (copie a estrutura de leads)
- [x] Registrar a rota em `src/app.ts`
- [x] Testes de integração do webhook de cadastros, substituindo os `it.todo` do bloco 2
- [x] Atualizar o `tools/seed.ts` para mandar cadastros

## Bloco 3 — Sincronização da produção (2h) · ADR 0003

- [x] `runProductionSync` seguindo o passo a passo do arquivo
- [x] Rodar contra o `fake-crm` (ele falha 15% das vezes: o retry tem que segurar)
- [x] Testes de integração com Postgres real: sync, vínculo tardio, migration e recuperação completa
- [x] Script `npm run sync` com execução única e fechamento do pool; agendamento contínuo fora do escopo
- [x] Forçar falha (`FAIL_RATE=1`) e verificar o alerta no log com `DISCORD_WEBHOOK_URL` vazio

O envio ao Discord continua disponível ao configurar um webhook; a demonstração deste bloco não envia mensagens externas.

## Bloco 4 — Leituras (1h30)

- [ ] `findJourney`: um SELECT com `LEFT JOIN leads` + `SUM/COUNT/MIN/MAX` em `production`
- [ ] `attribution`: `GROUP BY COALESCE(l.source, 'sem_origem')`, filtrando por período de `paid_at`
- [ ] Rotas `GET /partners/:code/journey` (404 se não existir) e `GET /metrics/attribution?from=&to=`
- [ ] Rodar `EXPLAIN ANALYZE` na query de atribuição e anotar no README se os índices estão sendo usados

## Bloco 5 — Fechamento (1h15)

- [ ] README: print do `curl` da atribuição e do alerta no Discord
- [ ] CI verde no GitHub (badge no README)
- [ ] Tag `v1.0.0`

## Extras (se sobrar tempo, ou na semana seguinte)

- Autenticação JWT nas rotas de leitura (você já tem o projeto de login: reaproveite)
- OpenAPI/Swagger em `/docs`
- Fila (BullMQ + Redis) no lugar do `setInterval`
- Métricas Prometheus em `/metrics`

## Perguntas que vão te fazer na entrevista (treine as respostas)

1. O que acontece se o mesmo webhook chegar duas vezes ao mesmo tempo?
2. Por que o HMAC é calculado sobre o corpo bruto e não sobre `req.body`?
3. Se o job cair na página 7 de 20, o que acontece na próxima execução?
4. Por que não re-tentar um erro 400?
5. Como você mediria a qualidade do matching? (dica: `match_method`)
