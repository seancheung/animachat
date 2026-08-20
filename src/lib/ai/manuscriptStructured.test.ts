import { describe, expect, it } from "vitest";
import { parseManuscriptAssistantFields } from "./manuscriptStructured";

const manuscript = {
  characters: [{
    id: "mira",
    name: "Mira",
    description: "",
    personality: "",
    appearance: "",
    voice: "",
  }],
};

describe("manuscript structured assistant fields", () => {
  it("strictly parses settings updates", () => {
    expect(parseManuscriptAssistantFields(
      "settings-assistant",
      JSON.stringify({ synopsis: "A new direction." }),
      manuscript
    )).toEqual({ type: "settings-update", update: { synopsis: "A new direction." } });
  });

  it("rejects malformed JSON and settings blocks without supported fields", () => {
    expect(() => parseManuscriptAssistantFields("settings-assistant", "{synopsis: bad}", manuscript))
      .toThrow();
    expect(() => parseManuscriptAssistantFields(
      "settings-assistant",
      JSON.stringify({ synopsis: 42 }),
      manuscript
    )).toThrow("string synopsis or style");
  });

  it("runs character-design schema validation after JSON parsing", () => {
    const sheet = {
      name: "Mira",
      description: "Alchemist",
      personality: "Guarded",
      appearance: "Ink-stained apron",
      voice: '"Careful."',
    };
    expect(parseManuscriptAssistantFields(
      "character-design",
      JSON.stringify({
        operations: [{ operation: "update", characterId: "mira", character: sheet }],
      }),
      manuscript
    )).toEqual({ type: "character-updates", updates: [{ characterId: "mira", character: sheet }] });
    expect(() => parseManuscriptAssistantFields(
      "character-design",
      JSON.stringify({ operations: [{ operation: "update", characterId: "missing", character: sheet }] }),
      manuscript
    )).toThrow("valid character");
  });
});
