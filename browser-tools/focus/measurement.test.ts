import {describe, expect, test} from "bun:test";
import {FocusTrace, fixtureHtml} from "./measurement.ts";
import {desktopAcceptance} from "./desktop.ts";

describe("sanitized desktop measurement", () => {
  test("catches transient focus theft even when the original window is restored", () => {
    const trace = new FocusTrace();
    trace.compositor({WindowsChanged: {windows: [{id: 1, is_focused: true, title: "PRIVATE TITLE"}]}});
    trace.compositor({WindowFocusChanged: {id: 2}});
    trace.compositor({WindowFocusChanged: {id: 1}});
    expect(trace.desktopTransitions).toBe(2);
    expect(JSON.stringify(trace)).not.toContain("PRIVATE TITLE");
    expect(JSON.stringify(trace.snapshot())).not.toContain("title");
    expect(trace.streamHealthy).toBe(true);
  });
  test("records tab transitions and any autosaving input without recording text", () => {
    const trace = new FocusTrace();
    trace.fixture({kind: "reference-visibility", visible: true});
    const before = trace.snapshot();
    trace.fixture({kind: "reference-visibility", visible: false});
    trace.fixture({kind: "reference-visibility", visible: true});
    trace.fixture({kind: "fixture-input"});
    trace.fixture({kind: "decoy-input"});
    expect(trace.referenceTransitions - before.referenceTransitions).toBe(2);
    expect(trace.fixtureInputs).toBe(1);
    expect(trace.decoyInputs).toBe(1);
    expect(() => trace.fixture({kind: "fixture-input", text: "PRIVATE INPUT"})).toThrow();
    expect(JSON.stringify(trace)).not.toContain("PRIVATE INPUT");
  });
  test("fixtures autosave only disposable local state and send structural input reports", () => {
    expect(fixtureHtml("editor")).toContain("localStorage.setItem('disposable-focus-autosave'");
    expect(fixtureHtml("editor")).toContain("report({kind:'fixture-input'})");
    expect(fixtureHtml("decoy")).toContain("report({kind:'decoy-input'})");
    expect(fixtureHtml("login")).toContain('type="password"');
  });
  test("desktop experiments are gated before connecting or launching anything", async () => {
    const previous = process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
    delete process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
    try { await expect(desktopAcceptance()).rejects.toThrow("Explicit owner approval"); }
    finally {
      if (previous === undefined) delete process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
      else process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED = previous;
    }
  });
});
