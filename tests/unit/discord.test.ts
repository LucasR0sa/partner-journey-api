import { describe, expect, it, vi } from "vitest";
import { createDiscordAlerter } from "../../src/shared/alerts/discord.js";

describe("createDiscordAlerter", () => {
  it("envia um embed com título e campos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await createDiscordAlerter("https://discord.test/webhook", fetchMock).notify("Sync falhou", { job: "production_sync", tentativas: 5 });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.embeds[0].title).toContain("Sync falhou");
    expect(body.embeds[0].fields).toEqual(expect.arrayContaining([{ name: "job", value: "production_sync", inline: true }]));
  });

  it("nunca lança erro, mesmo se o Discord estiver fora", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(createDiscordAlerter("https://discord.test/webhook", fetchMock).notify("x", {})).resolves.toBeUndefined();
  });

  it("sem URL configurada, não chama a rede", async () => {
    const fetchMock = vi.fn();
    await createDiscordAlerter("", fetchMock).notify("x", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
