// Retry com backoff exponencial + jitter: 1ª espera ~0,5s, depois ~1s, ~2s...
// O jitter (aleatoriedade) evita que vários jobs tentem de novo no mesmo instante.
export interface RetryOptions {
  attempts: number;
  baseMs: number;
  maxMs?: number;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2)); // "equal jitter"
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { attempts, baseMs, maxMs = 30_000, shouldRetry = () => true, onRetry, random = Math.random } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err)) break;
      const delay = backoffDelay(attempt, baseMs, maxMs, random);
      onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}
