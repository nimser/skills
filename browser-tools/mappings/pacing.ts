import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export interface PacedStep {
  check: () => Promise<boolean>;
  act: () => Promise<void>;
  verify: () => Promise<boolean>;
}

export interface PacingOptions {
  minMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
}

export class UncertainActionError extends Error {
  constructor(index: number) {
    super(`Action ${index + 1} has an unverified outcome; inspect before any further action. No retry was attempted.`);
    this.name = "UncertainActionError";
  }
}

export function randomPauseMs({ minMs = 300, maxMs = 800 }: PacingOptions = {}): number {
  if (!Number.isSafeInteger(minMs) || !Number.isSafeInteger(maxMs) || minMs < 200 || maxMs < minMs || maxMs > 60_000) {
    throw new Error("Pacing requires integer bounds: 200 <= minMs <= maxMs <= 60000");
  }
  return randomInt(minMs, maxMs + 1);
}

export async function runPaced(steps: readonly PacedStep[], options: PacingOptions = {}): Promise<void> {
  randomPauseMs(options);
  if (steps.length > 20) throw new Error("Use at most 20 steps per reviewed batch");
  for (const [index, step] of steps.entries()) {
    options.signal?.throwIfAborted();
    if (index > 0) await delay(randomPauseMs(options), undefined, { signal: options.signal });
    if (!(await step.check())) throw new Error(`Precondition failed before action ${index + 1}; that action was not attempted`);
    options.signal?.throwIfAborted();
    try {
      await step.act();
      if (!(await step.verify())) throw new UncertainActionError(index);
    } catch {
      throw new UncertainActionError(index);
    }
  }
}
