# Evolução do Partner Journey API

As etapas abaixo registram o que foi entregue e as melhorias futuras. Cada etapa funcional
tem testes e revisão por PR; publicação da versão acontece somente depois do merge.

## Bloco 0 — Preparação

- [x] Docker Compose com PostgreSQL, banco isolado de testes e CRM fictício
- [x] Instalação reproduzível, migrations e CI no GitHub Actions
- [x] Arquitetura em camadas e três ADRs documentadas

## Bloco 1 — Webhook de leads

- [x] HMAC sobre o corpo bruto, validação e normalização
- [x] Idempotência com constraint e teste de dez entregas concorrentes
- [x] Seed assinado e rejeição de assinatura inválida sem gravar dados

## Bloco 2 — Cadastro + matching · ADR 0002

- [x] `pickOriginLead` com prioridade por e-mail, last touch e limites de 90 dias
- [x] `signup.repository.ts`: buscar candidatos (mesmo e-mail **ou** telefone) e UPSERT em `partners`
- [x] `createSignupService` + `signup.routes.ts`, seguindo a estrutura de leads
- [x] Registrar a rota em `src/app.ts`
- [x] Testes de integração do webhook de cadastros e casos de borda do matching
- [x] Atualizar o `tools/seed.ts` para mandar cadastros

## Bloco 3 — Sincronização da produção · ADR 0003

- [x] Sync incremental com cursor e transação por página
- [x] Rodar contra o `fake-crm` (ele falha 15% das vezes: o retry tem que segurar)
- [x] Testes de integração com Postgres real: sync, vínculo tardio, migration e recuperação completa
- [x] Script `npm run sync` com execução única e fechamento do pool; agendamento contínuo fora do escopo
- [x] Forçar falha (`FAIL_RATE=1`) e verificar o alerta no log com `DISCORD_WEBHOOK_URL` vazio
- [x] Preservação de contratos sem cadastro, reconciliação da corrida e transferência de parceiro

O envio ao Discord é opcional; a demonstração usa o alerta local, sem mensagens externas.

## Bloco 4 — Leituras

- [x] `findJourney`: um SELECT com `LEFT JOIN leads` + agregação LATERAL de `production`
- [x] `attribution`: métricas independentes de cadastro e produção por canal, com `sem_origem` e `sem_cadastro`
- [x] Rotas `GET /partners/:code/journey` (404 se não existir) e `GET /metrics/attribution?from=&to=`
- [x] Integração com PostgreSQL real e datas inclusivas no fuso do negócio (São Paulo)
- [x] `EXPLAIN ANALYZE` das duas queries, índice por `paid_at` na migration 003 e comparação no README
- [x] Demonstração com seed + sync e curls reais no README; leituras sem autenticação documentadas

## Bloco 5 — Fechamento

- [x] README final: problema, solução, decisões, demonstração, respostas JSON e exemplo de alerta
- [x] CI com formatação, lint, TypeScript, testes e build Docker; badge no README
- [x] Changelog 1.0.0 e exemplos executáveis no REST Client
- [x] Correção do fechamento mensal no fuso de São Paulo, com teste de regressão

Publicação após o merge do PR de fechamento: tag anotada `v1.0.0`, texto para a release
e remoção das branches remotas já integradas. Não confundir preparação com release publicada.

## Próximos passos

- Autenticação JWT e autorização nas rotas de leitura
- Advisory lock para impedir sincronizações simultâneas
- INSERT em lote após medir o ganho com `EXPLAIN (ANALYZE, BUFFERS)`
- OpenAPI/Swagger em `/docs`
- Agendamento e fila (BullMQ + Redis); a sync atual é um comando de execução única
- Métricas Prometheus em `/metrics`

## Perguntas que vão te fazer na entrevista (treine as respostas)

1. O que acontece se o mesmo webhook chegar duas vezes ao mesmo tempo?
2. Por que o HMAC é calculado sobre o corpo bruto e não sobre `req.body`?
3. Se o job cair na página 7 de 20, o que acontece na próxima execução?
4. Por que não re-tentar um erro 400?
5. Como você mediria a qualidade do matching? (dica: `match_method`)
