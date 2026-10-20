import { z } from "zod";

// Webhook enviado pelo CRM quando um parceiro conclui o cadastro.
export const signupWebhookSchema = z.object({
  event_id: z.string().min(1),
  crm_code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  email: z.string().optional(),
  phone: z.string().optional(),
  signed_up_at: z.coerce.date(),
});

export type SignupWebhook = z.infer<typeof signupWebhookSchema>;
