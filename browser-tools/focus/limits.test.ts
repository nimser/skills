import {expect, test} from "bun:test";
import {parseWindowRequest, windowLease} from "./lease.ts";
import {validDuration, windowRemaining} from "./limits.js";
import {actions, FocusPolicy, parseLease} from "./policy.ts";

const sessionId = "00000000-0000-0000-0000-000000000002";
const now = 100_000, browserId = "fixture-browser";
const request = {sessionId, mode: "foreground", targets: ["owned"], pinnedBrowserId: browserId};

test("defaults to 15 minutes, allows a requested duration and rejects purported approval or expiry", () => {
  expect(parseWindowRequest(request).seconds).toBe(900);
  expect(parseWindowRequest({...request, seconds: 5400}).seconds).toBe(5400);
  for (const seconds of [null, 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, "900"]) {
    expect(validDuration(seconds, now)).toBe(false);
    expect(() => parseWindowRequest({...request, seconds})).toThrow("invalid browser window request");
  }
  for (const raw of [{...request, mode: "background"}, {...request, sessionId: ""}, {...request, targets: ["owned", "foreign"]},
    {...request, pinnedBrowserId: undefined}, {...request, confirmed: true}, {...request, expiresAt: now + 1000}]) {
    expect(() => parseWindowRequest(raw)).toThrow("invalid browser window request");
  }
});

test("uses one fixed expiry and binds every window to a browser generation and a session", () => {
  const selection = parseWindowRequest({...request, seconds: 5400});
  const first = windowLease(selection, browserId, now), next = windowLease(selection, browserId, now + 10_000);
  const access = {...first.window, expiresAt: first.expiresAt};
  expect(first.targets).toEqual(["owned"]);
  expect(first.launch).toBe(false);
  expect(first.expiresAt).toBe(now + 5_400_000);
  expect(windowRemaining(access, sessionId, first.expiresAt - 1)).toBe(1);
  expect(() => windowRemaining(access, sessionId, first.expiresAt)).toThrow("expired");
  expect(() => windowRemaining(access, "other", now)).toThrow("another Pi session");
  expect(() => parseLease(first, "different-generation", now)).toThrow("invalid");
  expect(next.window!.token).not.toBe(first.window!.token);
  expect(next.expiresAt - first.expiresAt).toBe(10_000);
  const launch = windowLease(selection, undefined, now);
  expect(launch.targets).toEqual([]);
  expect(launch.launch).toBe(true);
  expect(windowLease(selection, "different-generation", now).targets).toEqual([]);
});

test("requires the window capability and separate browser-wide approval", () => {
  const first = windowLease(parseWindowRequest(request), browserId, now);
  let current = first, clock = now;
  const scoped = new FocusPolicy(browserId, () => current, () => clock, "foreground", undefined, first.window!.token);
  expect(() => scoped.connectionAllowed()).not.toThrow();
  expect(() => new FocusPolicy(browserId, () => first, () => now, "foreground").connectionAllowed()).toThrow("capability");
  expect(() => new FocusPolicy(browserId, () => first, () => now, "direct", undefined, first.window!.token).connectionAllowed()).toThrow("separate browser-wide");
  clock = first.expiresAt;
  expect(() => scoped.connectionAllowed()).toThrow("expired");
  current = windowLease(parseWindowRequest({...request, mode: "direct"}), browserId, clock);
  expect(current.actions).toEqual([...actions]);
  expect(() => scoped.connectionAllowed()).toThrow("replaced");
});
