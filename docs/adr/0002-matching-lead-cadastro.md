# ADR 0002 — Como ligar o cadastro ao lead de origem

**Status:** aceito

## Contexto
O lead entra pelo marketing; o cadastro acontece dias depois, no CRM, digitado por outra pessoa.
Não existe um id em comum. Sem esse vínculo, não dá para saber quais parceiros (e quanta produção)
vieram de cada campanha.

## Decisão
1. **Normalizar** antes de comparar: e-mail minúsculo e sem espaços; telefone só com dígitos,
   sem DDI 55, sem zero à esquerda, celular antigo ganha o 9.
2. **Janela:** só valem leads anteriores ao cadastro e de no máximo 90 dias antes.
3. **Prioridade:** e-mail antes de telefone (telefone é mais reaproveitado e mais digitado errado).
4. **Empate:** vence o lead mais recente (atribuição *last touch*).
5. Gravar **como** casou (`match_method`: email | phone | none) para auditar a taxa de match.

A escolha fica numa função pura, `pickOriginLead`, testada sem banco.

## Alternativas consideradas
- *Fuzzy match por nome*: muitos falsos positivos com nomes comuns. Descartado.
- *First touch*: favorece campanhas de topo de funil; o time comercial pediu last touch.

## Consequências
- (+) Regra explícita, auditável e coberta por testes.
- (−) Quem troca de e-mail **e** de telefone entre o lead e o cadastro fica sem origem (`none`).
