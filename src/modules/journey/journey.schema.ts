import { z } from "zod";

const DAY_MS = 86_400_000;
const calendarDate = z.iso.date().refine((date) => !date.startsWith("0000-"), {
  message: "use um ano entre 0001 e 9999",
});

export const partnerCodeSchema = z.string().min(1).max(50);

// Datas do negócio usam São Paulo no SQL; UTC aqui só conta dias de calendário, incluindo as pontas.
export const attributionQuerySchema = z
  .object({ from: calendarDate, to: calendarDate })
  .refine(({ from, to }) => from <= to, {
    message: "from precisa ser anterior ou igual a to",
    path: ["to"],
  })
  .refine(
    ({ from, to }) =>
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        DAY_MS +
        1 <=
      366,
    {
      message: "o período deve conter no máximo 366 dias, incluindo os limites",
      path: ["to"],
    },
  );

export type AttributionQuery = z.infer<typeof attributionQuerySchema>;
