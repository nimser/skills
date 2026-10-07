import { describe, expect, test } from "bun:test";
import { randomPauseMs, runPaced, UncertainActionError, type PacedStep } from "./pacing.ts";

function step(events: string[], name: string): PacedStep {
  return {
    check: async () => { events.push(`${name}:check`); return true; },
    act: async () => { events.push(`${name}:act`); },
    verify: async () => { events.push(`${name}:verify`); return true; },
  };
}

describe("bounded sequential pacing", () => {
  test("uses non-zero random pauses within the documented range", () => {
    const delays = Array.from({ length: 100 }, () => randomPauseMs());
    expect(delays.every(delay => delay >= 300 && delay <= 800)).toBe(true);
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(randomPauseMs({ minMs: 200, maxMs: 200 })).toBe(200);
    for (const bounds of [{ minMs: 0 }, { minMs: 800, maxMs: 300 }, { maxMs: 60_001 }, { minMs: 200.5 }]) {
      expect(() => randomPauseMs(bounds)).toThrow("Pacing requires");
    }
  });

  test("checks, acts, confirms and then pauses before the next step", async () => {
    const events: string[] = [];
    const started = performance.now();
    await runPaced([step(events, "a"), step(events, "b")], { minMs: 200, maxMs: 201 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(190);
    expect(events).toEqual(["a:check", "a:act", "a:verify", "b:check", "b:act", "b:verify"]);
  });

  test("stops before acting when the precondition fails", async () => {
    const events: string[] = [];
    await expect(runPaced([{ ...step(events, "a"), check: async () => false }, step(events, "b")])).rejects.toThrow("Precondition failed");
    expect(events).toEqual([]);
  });

  test.each(["act", "verify"] as const)("never retries an uncertain %s or continues the batch", async field => {
    const events: string[] = [];
    const first = step(events, "a");
    if (field === "act") first.act = async () => { events.push("a:act"); throw new Error("private data"); };
    else first.verify = async () => false;
    await expect(runPaced([first, step(events, "b")])).rejects.toBeInstanceOf(UncertainActionError);
    expect(events.filter(event => event === "a:act").length).toBe(1);
    expect(events.some(event => event.startsWith("b:"))).toBe(false);
  });

  test("abort before a batch or during a pause prevents further actions", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await expect(runPaced([step(events, "a")], { signal: controller.signal })).rejects.toThrow();
    expect(events).toEqual([]);
    const pending = runPaced([step(events, "a"), step(events, "b")], { signal: AbortSignal.timeout(50) });
    await expect(pending).rejects.toThrow();
    expect(events).toEqual(["a:check", "a:act", "a:verify"]);
  });

  test("rejects oversized batches before any action", async () => {
    const events: string[] = [];
    await expect(runPaced(Array.from({ length: 21 }, () => step(events, "a")))).rejects.toThrow("at most 20");
    expect(events).toEqual([]);
  });
});
