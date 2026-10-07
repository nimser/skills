import { describe, expect, test } from "bun:test";
import { parseMappings } from "./model.ts";
import { fixtureMappings } from "./fixture.ts";

describe("mapping schema", () => {
  test("accepts observed pages and an empty inventory", () => {
    const observed = fixtureMappings();
    observed.pages.editor!.elements.save!.text = "Save";
    expect(parseMappings(observed).version).toBe(1);
    expect(parseMappings({ version: 1, pages: {} }).pages).toEqual({});
  });

  test.each([
    (value: any) => { value.version = 2; },
    (value: any) => { value.pages.editor.origin = "https://user:secret@example.test"; },
    (value: any) => { value.pages.editor.origin = "https://example.test/login"; },
    (value: any) => { value.pages.editor.pathname = "/editor?token=secret"; },
    (value: any) => { value.pages.editor.pathname = "//evil.test/editor"; },
    (value: any) => { value.pages.editor.pathname = "/a/../editor"; },
    (value: any) => { value.pages.editor.markers = []; },
    (value: any) => { value.pages.editor.observedAt = "2026-02-30T00:00:00.000Z"; },
    (value: any) => { value.pages.editor.elements.title.value = "private input"; },
    (value: any) => { value.pages.editor.elements.save.risk = "safe"; },
    (value: any) => { value.pages.editor.elements.save.text = ""; },
    (value: any) => { value.pages.editor.elements.save.text = 42; },
    (value: any) => { value.pages.editor.script = "document.querySelector('#save').click()"; },
    (value: any) => { value.pages.editor.notes = [""]; },
  ])("rejects unsupported or unsafe structure %#", mutate => {
    const value = fixtureMappings();
    mutate(value);
    expect(() => parseMappings(value)).toThrow("Invalid mapping");
  });
});
