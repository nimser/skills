export const risks = ["read", "local-edit", "persist", "publish", "delete"] as const;
export type Risk = (typeof risks)[number];

export interface Target {
  selector: string;
  tag?: string;
  type?: string;
  text?: string;
}

export interface ElementMapping extends Target {
  risk: Risk;
  required: boolean;
}

export interface PageMapping {
  origin: string;
  pathname: string;
  state: string;
  observedAt: string;
  markers: Target[];
  elements: Record<string, ElementMapping>;
  notes?: string[];
}

export interface BrowserMappings {
  version: 1;
  pages: Record<string, PageMapping>;
}

function fail(path: string): never {
  throw new Error(`Invalid mapping at ${path}; see BROWSER-MAPPINGS.md`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(path);
}

function text(value: unknown, path: string, max = 500): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(path);
}

function target(value: unknown, path: string, element = false) {
  const item = object(value, path);
  keys(item, ["selector", "tag", "type", "text", ...(element ? ["risk", "required"] : [])], path);
  text(item.selector, `${path}.selector`);
  if (item.tag !== undefined && (typeof item.tag !== "string" || !/^[a-z][a-z0-9-]*$/.test(item.tag))) fail(`${path}.tag`);
  if (item.type !== undefined) text(item.type, `${path}.type`, 40);
  if (item.text !== undefined) text(item.text, `${path}.text`);
  if (element && (!risks.includes(item.risk as Risk) || typeof item.required !== "boolean")) fail(path);
}

export function parseMappings(value: unknown): BrowserMappings {
  const root = object(value, "root");
  keys(root, ["version", "pages"], "root");
  if (root.version !== 1) fail("version");
  const pages = object(root.pages, "pages");
  if (Object.keys(pages).length > 100) fail("pages");
  for (const [key, value] of Object.entries(pages)) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(key)) fail("pages key");
    const path = `pages.${key}`;
    const page = object(value, path);
    keys(page, ["origin", "pathname", "state", "observedAt", "markers", "elements", "notes"], path);
    text(page.origin, `${path}.origin`);
    let url: URL;
    try { url = new URL(page.origin); } catch { fail(`${path}.origin`); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== page.origin) fail(`${path}.origin`);
    text(page.pathname, `${path}.pathname`);
    if (!page.pathname.startsWith("/") || page.pathname.startsWith("//") || /[?#\\\s]/.test(page.pathname)
      || new URL(page.pathname, url).pathname !== page.pathname) fail(`${path}.pathname`);
    text(page.state, `${path}.state`, 120);
    if (typeof page.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(page.observedAt)
      || !Number.isFinite(Date.parse(page.observedAt)) || new Date(page.observedAt).toISOString() !== page.observedAt) fail(`${path}.observedAt`);
    if (!Array.isArray(page.markers) || page.markers.length < 1 || page.markers.length > 20) fail(`${path}.markers`);
    page.markers.forEach((value, index) => target(value, `${path}.markers.${index}`));
    const elements = object(page.elements, `${path}.elements`);
    if (Object.keys(elements).length > 100) fail(`${path}.elements`);
    for (const [key, value] of Object.entries(elements)) {
      if (!/^[a-z][a-zA-Z0-9-]{0,79}$/.test(key)) fail(`${path}.elements key`);
      target(value, `${path}.elements.${key}`, true);
    }
    if (page.notes !== undefined) {
      if (!Array.isArray(page.notes) || page.notes.length > 20) fail(`${path}.notes`);
      page.notes.forEach((note, index) => text(note, `${path}.notes.${index}`, 1000));
    }
  }
  return value as BrowserMappings;
}
