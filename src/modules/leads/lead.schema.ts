import { z } from "zod";

// Formato do webhook enviado pelo provedor de marketing (inspirado no RD Station).
export const leadWebhookSchema = z
  .object({
    event_id: z.string().min(1).max(200),
    occurred_at: z.coerce.date(),
    source: z.string().min(1).max(50),
    campaign: z.string().max(200).optional(),
    contact: z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
  })
  .refine((b) => b.contact.email || b.contact.phone, { message: "contato precisa de e-mail ou telefone", path: ["contact"] });

export type LeadWebhook = z.infer<typeof leadWebhookSchema>;
