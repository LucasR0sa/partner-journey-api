import { describe, it } from "vitest";

// Lista viva do que falta (aparece como "todo" no relatório de testes).
// Ao implementar cada bloco, mova o caso para um arquivo próprio com o teste de verdade.
describe("Leituras (bloco 4)", () => {
  it.todo("GET /partners/:code/journey devolve lead, cadastro e produção");
  it.todo("GET /partners/:code/journey responde 404 para código inexistente");
  it.todo("GET /metrics/attribution agrupa parceiros e produção por canal");
});
