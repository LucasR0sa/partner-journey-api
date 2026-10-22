import { describe, it } from "vitest";

// Lista viva do que falta (aparece como "todo" no relatório de testes).
// Ao implementar cada bloco, mova o caso para um arquivo próprio com o teste de verdade.
describe("runProductionSync (bloco 3)", () => {
  it.todo("sincroniza todas as páginas e salva o cursor");
  it.todo("rodar duas vezes não duplica produção");
  it.todo("re-tenta 503 e conclui");
  it.todo(
    "esgotando as tentativas, grava last_error e chama o alerta do Discord",
  );
  it.todo("retoma do último cursor confirmado depois de uma falha");
});

describe("Leituras (bloco 4)", () => {
  it.todo("GET /partners/:code/journey devolve lead, cadastro e produção");
  it.todo("GET /partners/:code/journey responde 404 para código inexistente");
  it.todo("GET /metrics/attribution agrupa parceiros e produção por canal");
});
