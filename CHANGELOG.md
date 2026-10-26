# Changelog

As mudanças relevantes do projeto são registradas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
com versões seguindo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-26

### Added

- Fluxo de leads com HMAC, idempotência no PostgreSQL e teste de dez entregas concorrentes
  (base inicial do projeto).
- Matching com casos de borda e formatação consistente ([#1]).
- Webhook de cadastros com normalização, matching por e-mail/telefone e UPSERT de parceiros;
  seed com 300 leads e 150 cadastros assinados ([#2]).
- Sync incremental do CRM com cursor persistido, transação por página, retry com backoff/jitter,
  alerta no Discord e comando de execução única ([#3]).
- Vínculo tardio de produção e `sync:full` para recuperar contratos ignorados em bases antigas,
  com migration que preserva dados existentes ([#4]).
- Jornada do parceiro e atribuição por canal com agregações SQL, validação de períodos,
  índice por data de pagamento e análise de planos com EXPLAIN ([#7]).
- README de apresentação, roteiro atualizado, exemplos no REST Client e preparação da versão 1.0.0;
  suíte com 90 testes, PostgreSQL real e CI com build Docker ([#8]).

### Fixed

- Contratos sem cadastro não são mais descartados: o código do parceiro é preservado e o vínculo
  pode ser feito depois, sem reler o CRM ([#4]).
- Corrida entre sync e cadastro reproduzida com duas conexões: reconciliação ao fim da sync
  garante consistência eventual; releitura não desfaz vínculo confirmado ([#5]).
- Transferência de contrato não herda o parceiro antigo quando o novo cadastro ainda não existe ([#6]).
- Atribuição de novos parceiros respeita o calendário de `America/Sao_Paulo`: cadastro de 31/10
  às 22h pertence a outubro, mesmo quando seu timestamp UTC já está em novembro ([#8]).

[Unreleased]: https://github.com/LucasR0sa/partner-journey-api/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/LucasR0sa/partner-journey-api/releases/tag/v1.0.0
[#1]: https://github.com/LucasR0sa/partner-journey-api/pull/1
[#2]: https://github.com/LucasR0sa/partner-journey-api/pull/2
[#3]: https://github.com/LucasR0sa/partner-journey-api/pull/3
[#4]: https://github.com/LucasR0sa/partner-journey-api/pull/4
[#5]: https://github.com/LucasR0sa/partner-journey-api/pull/5
[#6]: https://github.com/LucasR0sa/partner-journey-api/pull/6
[#7]: https://github.com/LucasR0sa/partner-journey-api/pull/7
[#8]: https://github.com/LucasR0sa/partner-journey-api/pull/8
