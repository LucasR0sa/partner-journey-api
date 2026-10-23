# ADR 0003 — Sincronização incremental com cursor, retry e alerta

**Status:** aceito

## Contexto

A produção vem de uma API de CRM paginada e instável (503 em ~15% das chamadas no CRM falso, como em
APIs reais). Baixar tudo a cada execução é lento e caro; parar no primeiro erro deixa dados pela metade.

## Decisão

- **Cursor salvo** em `sync_state`: cada execução continua de onde a anterior parou.
- **Uma transação por página**: UPSERT dos contratos + gravação do novo cursor juntos.
  Se o processo cair, nada fica pela metade e a próxima execução retoma da última página confirmada.
- **Contrato nunca é descartado; o vínculo com o parceiro é tardio e acontece no cadastro.**
  `production.partner_code` é obrigatório e preserva o código recebido do CRM;
  `partner_id` pode ser `null` até o parceiro existir. O webhook faz o UPSERT do parceiro
  e o UPDATE dos contratos sem vínculo do mesmo código na mesma transação.
  O sync conta `upserted` e `unlinked`; o log do cadastro registra `linkedContracts`.
- **Recuperação explícita** com `npm run sync:full`: reinicia somente o cursor e reprocessa
  as páginas com UPSERT idempotente, inclusive para recuperar contratos que versões anteriores ignoraram.
- **Retry com backoff exponencial e jitter** (`withRetry`) só para erros temporários (5xx, 429).
  Erro 4xx não é re-tentado: é bug ou credencial, e insistir não resolve.
- **Alerta no Discord** quando as tentativas se esgotam, com job, cursor e erro.
  O alerta nunca derruba o job (falha do Discord só vai para o log).

## Consequências

- (+) Execuções curtas, idempotentes e retomáveis; falha vira aviso em minutos, não descoberta no fim do mês.
- (+) Cadastro e produção podem chegar fora de ordem sem perda de contratos nem necessidade
  de reler páginas antigas para vincular os que já foram armazenados.
- (−) Contrato alterado em uma página já sincronizada só é corrigido numa re-sincronização completa
  (zerar o cursor). Aceitável para o volume atual; documentado no runbook.
