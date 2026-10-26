# Partner Journey API

[![CI](https://github.com/LucasR0sa/partner-journey-api/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasR0sa/partner-journey-api/actions/workflows/ci.yml)

API que acompanha cada parceiro **do lead ao resultado**: recebe leads do marketing por webhook,
liga cada cadastro ao lead de origem e sincroniza a produção do CRM, para responder
_"quanto cada canal trouxe de parceiros e de produção?"_.

Versão aberta, com dados fictícios, da arquitetura que construí em produção numa promotora de crédito
(96,8% dos cadastros ligados ao lead de origem).

```mermaid
flowchart LR
    RD["Leads<br/>(webhook)"] --> API["Partner Journey API"]
    CRM1["Cadastros<br/>(webhook)"] --> API
    CRM2["Contratos<br/>(API paginada)"] -- "sync com retry" --> API
    API --> DB[("PostgreSQL")]
    API -. "falha" .-> DC["Discord"]
```

## Stack

Node.js 22 · TypeScript · Express 5 · PostgreSQL 16 (SQL puro, sem ORM) · Zod · Pino · Vitest + Supertest · Docker · GitHub Actions

## Decisões técnicas

|                                                    | Decisão                                                                | Por quê                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [0001](docs/adr/0001-webhooks-idempotentes.md)     | Idempotência por `UNIQUE(event_id)` + `ON CONFLICT`                    | Webhook chega repetido; a constraint resolve até com várias réplicas |
| [0002](docs/adr/0002-matching-lead-cadastro.md)    | Matching normalizado, e-mail > telefone, last touch, janela de 90 dias | Liga o cadastro ao lead sem id em comum, de forma auditável          |
| [0003](docs/adr/0003-sincronizacao-incremental.md) | Cursor + transação por página + retry com backoff + alerta no Discord  | API instável não deixa dado pela metade nem falha em silêncio        |

Arquitetura completa: [docs/architecture.md](docs/architecture.md)

## Rodando

```bash
cp .env.example .env
docker compose up -d db fake-crm
npm ci
npm run migrate
npm run dev        # http://localhost:3000/health
npm run seed       # 300 leads + 150 cadastros fictícios via webhooks assinados
```

Ou tudo em container: `docker compose up --build`.

O Postgres do Compose fica em `localhost:5433` para não conflitar com uma instalação local na porta padrão.
Na primeira inicialização, ele também cria o banco isolado `journey_test` usado pelos testes de integração.

O seed cria os parceiros `P0001` a `P0150`, compatíveis com os códigos do fake-crm:
50 ligados por e-mail, 50 somente por telefone e 50 sem lead de origem.
Rodar novamente não duplica os leads nem os parceiros; os cadastros existentes são atualizados.

## Sincronização

Com o `.env` configurado, suba as dependências e aplique as migrations:

```bash
docker compose up -d db fake-crm
npm run migrate
```

Mantenha `npm run dev` aberto em outro terminal. Depois de criar os parceiros com o seed,
execute a sincronização uma vez:

```bash
npm run seed
npm run sync
```

O comando fecha o pool ao terminar; não há agendamento contínuo neste bloco.
Cada página confirma contratos e cursor na mesma transação. O retry tem até 5 tentativas
por página, com backoff exponencial e jitter, somente para HTTP 5xx e 429.

Exemplo observado com o seed e o fake-crm padrão (campos de processo omitidos):

```json
{
  "level": 30,
  "job": "production_sync",
  "pages": 20,
  "upserted": 2000,
  "unlinked": 532,
  "relinked": 0,
  "msg": "sincronização de produção concluída"
}
```

`upserted` conta inserções **e atualizações** de todos os contratos. `unlinked` conta, nessa execução,
os contratos gravados sem vínculo: `partner_code` é preservado e `partner_id` fica `null`.
Quando o webhook cadastra o parceiro, o UPSERT do cadastro e o vínculo da produção pendente
acontecem na mesma transação. O log do cadastro inclui `linkedContracts`, a quantidade vinculada;
o reenvio não conta novamente contratos já vinculados. Nenhum contrato é descartado.
Antes de marcar sucesso, a sync reconcilia pendências de qualquer página com parceiros já
confirmados e registra quantos contratos vinculou em `relinked`. `unlinked` reflete o estado
gravado em cada UPSERT, antes dessa reconciliação; não é o total final de pendências no banco.
O `COALESCE` preserva um vínculo confirmado durante uma releitura concorrente.

Na segunda execução, o total continuou em **2.000 linhas**, sendo 532 ainda sem cadastro:

```json
{
  "level": 30,
  "job": "production_sync",
  "pages": 1,
  "upserted": 100,
  "unlinked": 21,
  "relinked": 0,
  "msg": "sincronização de produção concluída"
}
```

O cursor final ficou em `1900`, início da última página: relê-la permite encontrar contratos novos
sem baixar todas as páginas novamente. Se o CRM só tiver uma página (ou estiver vazio), o cursor
inicial `null` também representa a última página. O vínculo tardio não consulta o CRM nem altera
o cursor: ele usa os contratos que já estão no PostgreSQL, inclusive os de páginas antigas.

### Recuperando contratos descartados na versão anterior

Use `sync:full` após atualizar uma base que ignorava contratos sem parceiro ou quando precisar
recapturar alterações do CRM em páginas anteriores. Com o banco e o fake-crm no ar:

```bash
npm run migrate
npm run sync:full
```

A migration **002** preenche `partner_code` nas linhas existentes antes de aplicar `NOT NULL`
e permite `partner_id` nulo. A migration 001, já aplicada, não é modificada.
O comando reinicia somente o cursor de `production_sync` e reutiliza a sincronização normal;
não apaga contratos. O `ON CONFLICT` permite repetir a recuperação sem duplicar produção.
Não precisa da API HTTP rodando: o comando acessa diretamente o CRM e o banco.

Na validação de uma base antiga, a migration preservou as 1.468 linhas existentes e a recuperação
trouxe os 532 contratos descartados, totalizando 2.000. Os 532 ficam disponíveis para vínculo
quando seus parceiros se cadastrarem. Depois, volte a usar `npm run sync` no fluxo incremental.
Se a recuperação falhar, as páginas confirmadas permanecem gravadas e `npm run sync` retoma
do cursor salvo. Execute sem outra sincronização em andamento; lock entre jobs fica fora deste PR.
Decisão: [ADR 0003](docs/adr/0003-sincronizacao-incremental.md).

### Forçando uma falha sem enviar mensagem ao Discord

No `.env`, deixe `DISCORD_WEBHOOK_URL=` vazio e confira que o terminal não tem essa variável
preenchida. Assim, o alerta fica somente no log. No PowerShell, force 100% de falhas do fake-crm:

```powershell
$env:FAIL_RATE = "1"
docker compose up -d --force-recreate fake-crm
docker compose logs -f fake-crm
```

Aguarde a mensagem `fake-crm em http://localhost:4000 (falha 100%)` e pressione `Ctrl+C`
para sair **dos logs**, sem parar o container. Então execute:

```powershell
npm run sync
$LASTEXITCODE # 1, depois das 5 tentativas
```

Exemplo de alerta (campos de processo omitidos):

```json
{
  "level": 40,
  "title": "Sync de produção falhou",
  "details": {
    "job": "production_sync",
    "cursor": "1900",
    "erro": "CRM respondeu 503",
    "tentativas": 5
  },
  "msg": "alerta (Discord desativado)"
}
```

A falha preenche `sync_state.last_error`, preserva o cursor e não desfaz páginas já confirmadas.
Restaure a taxa padrão de 15% e acompanhe os logs até o CRM ficar pronto novamente:

```powershell
Remove-Item Env:FAIL_RATE
docker compose up -d --force-recreate fake-crm
docker compose logs -f fake-crm
```

Saia dos logs com `Ctrl+C` e rode `npm run sync`. Ao concluir, `last_error` volta a `null`.
Se tiver alterado uma URL de Discord existente para a demonstração, restaure-a depois.

## Testes

```bash
npm test               # unitários + integração (precisa do Postgres do compose)
npm run test:unit      # só unitários, sem banco
```

Os testes de integração usam Postgres de verdade, inclusive um teste de **concorrência**
(o mesmo evento 10× em paralelo → 1 linha).

## Formatação

O Prettier padroniza a formatação e complementa as verificações do ESLint.
Os scripts aceitam arquivos ou diretórios. A CI verifica os arquivos adotados pelo formatador,
incluindo cadastros, sincronização, seus testes, a composição da API e o seed:

```bash
npm run format -- src/modules/signups/signup.service.ts tests/unit/match.test.ts
npm run format:check -- src/modules/signups/signup.service.ts tests/unit/match.test.ts
```

## Endpoints

| Método | Rota                             | Status |
| ------ | -------------------------------- | ------ |
| GET    | `/health`                        | ✅     |
| POST   | `/webhooks/leads`                | ✅     |
| POST   | `/webhooks/signups`              | ✅     |
| GET    | `/partners/:code/journey`        | 🚧     |
| GET    | `/metrics/attribution?from=&to=` | 🚧     |

### Exemplo: enviando um lead

```bash
BODY='{"event_id":"evt-1","occurred_at":"2026-10-01T12:00:00Z","source":"meta_ads","contact":{"email":"ana@exemplo.com"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | cut -d' ' -f2)
curl -X POST localhost:3000/webhooks/leads -H "content-type: application/json" -H "x-signature: sha256=$SIG" -d "$BODY"
# 201 {"id":1,"status":"created"}  → de novo: 200 {"status":"duplicate"}
```

## Estrutura

```
src/
  app.ts                 # monta o Express com as dependências injetadas
  server.ts              # sobe, aplica migrations, desliga com graça
  config/env.ts          # variáveis validadas com Zod (falha cedo)
  db/                    # pool, runner de migrations, .sql
  modules/<módulo>/      # routes → service → repository
  shared/                # normalize, hmac, retry, alertas, erros
tests/unit | tests/integration
tools/fake-crm.ts        # CRM falso que falha 15% das vezes, de propósito
docs/adr/                # decisões técnicas
```

## Licença

MIT
