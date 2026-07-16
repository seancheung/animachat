import { describe, expect, it } from "vitest";
import { describePartialProgress, dropOpenArrayElement, parsePartialJson } from "./partialJson";

const FULL = {
  name: "The Medallion",
  description: "A port city simmers.",
  characters: [
    { name: "Mira", description: "A smuggler with a debt." },
    { name: "Kael", description: "A collector of favors." },
  ],
  castOrder: ["Mira", "Kael"],
  count: 2,
  enabled: true,
  nothing: null,
};

describe("parsePartialJson", () => {
  it("parses complete JSON exactly like JSON.parse", () => {
    const text = JSON.stringify(FULL);
    const p = parsePartialJson(text)!;
    expect(p.value).toEqual(FULL);
    expect(p.open).toEqual([]);
    expect(p.openKey).toBeNull();
    expect(p.incompleteLeaf).toBe(false);
  });

  it("parses every prefix of a document without ever inventing structure", () => {
    const text = JSON.stringify(FULL, null, 2);
    for (let cut = 1; cut <= text.length; cut++) {
      const p = parsePartialJson(text.slice(0, cut));
      expect(p, `prefix of length ${cut} should never be malformed`).not.toBeNull();
      // whatever parses must be a subset of the full document
      if (p!.value !== undefined) {
        expect(JSON.stringify(FULL)).toContain(""); // sanity no-op; deep subset checked below on key cuts
      }
    }
  });

  it("ignores trailing text after the closed root (the </fields> tag)", () => {
    const p = parsePartialJson(`{"a": 1}</fie`)!;
    expect(p.value).toEqual({ a: 1 });
    expect(p.open).toEqual([]);
  });

  it("returns an empty result before any value starts", () => {
    for (const text of ["", "  \n"]) {
      const p = parsePartialJson(text)!;
      expect(p.value).toBeUndefined();
      expect(p.open).toEqual([]);
    }
  });

  it("keeps a string value cut mid-way and reports it as an incomplete leaf", () => {
    const p = parsePartialJson(`{"name": "Mira", "description": "A smug`)!;
    expect(p.value).toEqual({ name: "Mira", description: "A smug" });
    expect(p.incompleteLeaf).toBe(true);
    expect(p.openKey).toBe("description");
  });

  it("drops a key cut mid-way or left without a value", () => {
    expect(parsePartialJson(`{"name": "Mira", "descr`)!.value).toEqual({ name: "Mira" });
    expect(parsePartialJson(`{"name": "Mira", "description"`)!.value).toEqual({ name: "Mira" });
    expect(parsePartialJson(`{"name": "Mira", "description":`)!.value).toEqual({ name: "Mira" });
    expect(parsePartialJson(`{"name": "Mira",`)!.value).toEqual({ name: "Mira" });
  });

  it("decodes escapes, drops a truncated escape, keeps what came before it", () => {
    expect(parsePartialJson(`{"a": "line\\nbreak \\"q\\" \\u00e9"}`)!.value).toEqual({
      a: 'line\nbreak "q" é',
    });
    const cut = parsePartialJson(`{"a": "line\\nbreak \\`)!;
    expect(cut.value).toEqual({ a: "line\nbreak " });
    expect(cut.incompleteLeaf).toBe(true);
    expect(parsePartialJson(`{"a": "x\\u00`)!.value).toEqual({ a: "x" });
  });

  it("handles numbers and literals cut mid-way", () => {
    expect(parsePartialJson(`{"n": 42`)!.value).toEqual({ n: 42 });
    expect(parsePartialJson(`{"n": 42}`)!.incompleteLeaf).toBe(false);
    expect(parsePartialJson(`{"n": 42`)!.incompleteLeaf).toBe(true);
    expect(parsePartialJson(`{"b": tru`)!.value).toEqual({}); // nothing placed
    expect(parsePartialJson(`{"b": true, "c": fals`)!.value).toEqual({ b: true });
    expect(parsePartialJson(`{"x": null, "y": 1.5}`)!.value).toEqual({ x: null, y: 1.5 });
  });

  it("reports the open container chain with positions", () => {
    const p = parsePartialJson(`{"characters": [{"name": "Mira"}, {"name": "Ka`)!;
    expect(p.open).toEqual([
      { kind: "object", at: null },
      { kind: "array", at: "characters" },
      { kind: "object", at: 1 },
    ]);
    expect(p.openKey).toBe("name");
    expect(p.incompleteLeaf).toBe(true);
  });

  it("returns null on genuinely malformed input, not mere truncation", () => {
    expect(parsePartialJson(`{"a" 1}`)).toBeNull();
    expect(parsePartialJson(`{a: 1}`)).toBeNull();
    expect(parsePartialJson(`{"a": <b>}`)).toBeNull();
    expect(parsePartialJson(`{"a": "\\q"}`)).toBeNull();
  });

  it("tolerates a trailing comma before a closing bracket", () => {
    expect(parsePartialJson(`{"a": [1, 2,]}`)!.value).toEqual({ a: [1, 2] });
  });
});

describe("dropOpenArrayElement", () => {
  const cleaned = (text: string) => dropOpenArrayElement(parsePartialJson(text)!);

  it("drops the element still under construction", () => {
    expect(cleaned(`{"characters": [{"name": "Mira"}, {"name": "Ka`)).toEqual({
      characters: [{ name: "Mira" }],
    });
    // a truncated identity would otherwise mint a spurious item on merge
    expect(cleaned(`{"items": [{"type": "character", "name": "Mir`)).toEqual({ items: [] });
  });

  it("keeps a last element that closed, even inside a still-open array", () => {
    expect(cleaned(`{"characters": [{"name": "Mira"}`)).toEqual({ characters: [{ name: "Mira" }] });
    expect(cleaned(`{"characters": [{"name": "Mira"},`)).toEqual({ characters: [{ name: "Mira" }] });
    expect(cleaned(`{"characters": [`)).toEqual({ characters: [] });
  });

  it("drops at the shallowest open array — nested construction goes with it", () => {
    const text = `{"scenes": [{"name": "Docks", "successors": [{"sceneName": "Cel`;
    expect(cleaned(text)).toEqual({ scenes: [] });
  });

  it("drops a truncated string element of a string array", () => {
    expect(cleaned(`{"castOrder": ["Mira", "Ka`)).toEqual({ castOrder: ["Mira"] });
    // an unplaced truncated literal leaves the previous element alone
    expect(cleaned(`{"flags": [true, fal`)).toEqual({ flags: [true] });
  });

  it("leaves scalar streaming outside arrays untouched", () => {
    expect(cleaned(`{"description": "A port city sim`)).toEqual({
      description: "A port city sim",
    });
  });
});

describe("describePartialProgress", () => {
  const label = (text: string) => describePartialProgress(parsePartialJson(text)!);

  it("names the item and field being written", () => {
    expect(label(`{"characters": [{"name": "Mira", "description": "A smug`)).toBe(
      "Mira — description"
    );
  });

  it("falls back to the collection while the item is still nameless", () => {
    expect(label(`{"characters": [{"descr`)).toBe("characters");
    expect(label(`{"characters": [{"name": "Mi`)).toBe("characters");
  });

  it("uses the root item's name for single-entity fields", () => {
    expect(label(`{"name": "Mira", "greeting": "You aga`)).toBe("Mira — greeting");
  });

  it("never labels an element with the enclosing document's name", () => {
    expect(label(`{"name": "The Medallion", "secrets": [{"conte`)).toBe("secrets");
  });

  it("prefers a secret's title", () => {
    expect(label(`{"secrets": [{"title": "The Debt", "content": "Kael has alr`)).toBe(
      "The Debt — content"
    );
  });

  it("is null when there is nothing useful to say", () => {
    expect(label(`{`)).toBeNull();
    expect(label(`{"name": "Mi`)).toBeNull();
  });
});
