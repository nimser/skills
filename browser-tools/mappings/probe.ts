import type { PageMapping, Target } from "./model.ts";

export type TargetStatus = "ok" | "missing" | "ambiguous" | "hidden" | "disabled" | "mismatch" | "invalid-selector";
export interface TargetCheck {
  status: TargetStatus;
  matches: number;
  visible: number;
  enabled: boolean;
}
export interface PageCheck {
  ok: boolean;
  context: "ok" | "wrong-route" | "login-wall" | "marker-mismatch" | "unknown-element";
  markers: TargetCheck[];
  elements: Record<string, TargetCheck>;
}

// Keep this function self-contained for Playwright/Puppeteer page.evaluate().
export function probePage(mapping: PageMapping, elementKey?: string): PageCheck {
  const visible = (element: Element): boolean => {
    if (element.getClientRects().length === 0) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
        || style.opacity === "0" || node.hasAttribute("hidden")) return false;
    }
    return true;
  };
  const check = (target: Target, requireEnabled: boolean): TargetCheck => {
    let matches: Element[];
    try { matches = Array.from(document.querySelectorAll(target.selector)); }
    catch { return { status: "invalid-selector", matches: 0, visible: 0, enabled: false }; }
    const shown = matches.filter(visible);
    const element = matches[0];
    const enabled = !!element && !element.matches(":disabled, [aria-disabled='true']") && !element.closest("[inert]");
    let status: TargetStatus = "ok";
    if (!element) status = "missing";
    else if (matches.length !== 1) status = "ambiguous";
    else if (shown.length !== 1) status = "hidden";
    else if ((target.tag && element.tagName.toLowerCase() !== target.tag)
      || (target.type && element.getAttribute("type") !== target.type)) status = "mismatch";
    else if (requireEnabled && !enabled) status = "disabled";
    return { status, matches: matches.length, visible: shown.length, enabled };
  };
  const blocked = (context: PageCheck["context"], markers: TargetCheck[] = []): PageCheck => ({
    ok: false, context, markers, elements: {},
  });
  if (location.origin !== mapping.origin || location.pathname !== mapping.pathname) return blocked("wrong-route");
  if (Array.from(document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"]')).some(visible)) {
    return blocked("login-wall");
  }
  const markers = mapping.markers.map(target => check(target, false));
  if (markers.some(result => result.status !== "ok")) return blocked("marker-mismatch", markers);
  const elements: Record<string, TargetCheck> = {};
  const selected = elementKey === undefined ? Object.entries(mapping.elements) : Object.entries(mapping.elements).filter(([key]) => key === elementKey);
  if (elementKey !== undefined && selected.length === 0) return blocked("unknown-element", markers);
  let ok = true;
  for (const [key, target] of selected) {
    const result = check(target, target.risk !== "read");
    elements[key] = result;
    if (result.status !== "ok" && !(elementKey === undefined && result.status === "missing" && !target.required)) ok = false;
  }
  return { ok, context: "ok", markers, elements };
}
