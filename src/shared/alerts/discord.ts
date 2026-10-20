// Alerta de falha no Discord (mesma ideia do monitoramento do sistema da Nova).
// Sem URL configurada, só registra no log: o job nunca quebra por causa do alerta.
import { logger } from "../logger.js";

export interface Alerter {
  notify(title: string, details: Record<string, string | number>): Promise<void>;
}

export function createDiscordAlerter(webhookUrl: string, fetchImpl: typeof fetch = fetch): Alerter {
  return {
    async notify(title, details) {
      if (!webhookUrl) {
        logger.warn({ title, details }, "alerta (Discord desativado)");
        return;
      }
      const fields = Object.entries(details).map(([name, value]) => ({ name, value: String(value).slice(0, 1000), inline: true }));
      try {
        const res = await fetchImpl(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: `🚨 ${title}`, color: 0xef4444, fields, timestamp: new Date().toISOString() }] }),
        });
        if (!res.ok) logger.error({ status: res.status }, "Discord recusou o alerta");
      } catch (err) {
        logger.error({ err }, "falha ao enviar alerta ao Discord");
      }
    },
  };
}
