import { describe, expect, it, vi } from "vitest";
import { backoffDelay, withRetry } from "../../src/shared/retry.js";

const noSleep = async () => {};

describe("backoffDelay", () => {
  it("cresce exponencialmente e respeita o teto", () => {
    const mid = () => 0.5;
    expect(backoffDelay(1, 500, 30_000, mid)).toBe(375);
    expect(backoffDelay(2, 500, 30_000, mid)).toBe(750);
    expect(backoffDelay(10, 500, 30_000, mid)).toBe(22_500);
  });
});

describe("withRetry", () => {
  it("tenta de novo até dar certo", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("503")).mockRejectedValueOnce(new Error("503")).mockResolvedValue("ok");
    await expect(withRetry(fn, { attempts: 5, baseMs: 10, sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("desiste depois do número máximo de tentativas", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fora do ar"));
    await expect(withRetry(fn, { attempts: 3, baseMs: 10, sleep: noSleep })).rejects.toThrow("fora do ar");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("não insiste em erro que não é temporário", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("400"));
    await expect(withRetry(fn, { attempts: 5, baseMs: 10, sleep: noSleep, shouldRetry: () => false })).rejects.toThrow("400");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
