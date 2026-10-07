import type { BrowserMappings } from "./model.ts";

export function fixtureMappings(origin = "https://example.test"): BrowserMappings {
  return {
    version: 1,
    pages: {
      editor: {
        origin, pathname: "/editor", state: "Empty editor", observedAt: "2026-01-01T00:00:00.000Z",
        markers: [{ selector: "#editor", tag: "form" }],
        elements: {
          title: { selector: "#title", tag: "input", type: "text", risk: "local-edit", required: true },
          save: { selector: "#save", tag: "button", type: "submit", risk: "persist", required: true },
          preview: { selector: "#preview", risk: "read", required: false },
        },
      },
    },
  };
}
