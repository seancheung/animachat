import { describe, expect, it } from "vitest";
import {
  MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION,
  MAX_CHARACTER_DESIGN_OPERATIONS,
  validateCharacterDesignResult,
} from "./manuscriptCharacterDesign";
import { dropOpenArrayElement, parsePartialJson } from "./partialJson";

const sheet = (name: string) => ({
  name,
  description: `${name} description`,
  personality: `${name} personality`,
  appearance: `${name} appearance`,
  voice: `${name} voice`,
});

describe("character-design batch validation", () => {
  it("defines voice as example dialogue rather than physical vocal qualities", () => {
    expect(MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION).toContain("means example dialogue");
    expect(MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION).toContain("pitch, timbre, resonance");
    expect(MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION).toContain("only the character's own utterances");
  });

  it("accepts mixed create and update batches", () => {
    const result = validateCharacterDesignResult({
      message: "Added one and revised one.",
      operations: [
        { operation: "create", characterId: null, character: sheet("Mira") },
        { operation: "update", characterId: "kael", character: sheet("Kael") },
      ],
    }, new Set(["kael"]));
    expect(result).toEqual({
      ok: true,
      message: "Added one and revised one.",
      updates: [
        { characterId: null, character: sheet("Mira") },
        { characterId: "kael", character: sheet("Kael") },
      ],
    });
  });

  it("accepts an empty batch for discussion-only replies", () => {
    expect(validateCharacterDesignResult({ message: "Let's discuss them first.", operations: [] }, new Set()))
      .toEqual({ ok: true, message: "Let's discuss them first.", updates: [] });
  });

  it("supports the previous single-operation response shape", () => {
    const result = validateCharacterDesignResult({
      operation: "create",
      characterId: null,
      character: sheet("Mira"),
    }, new Set());
    expect(result.ok && result.updates).toHaveLength(1);
  });

  it("rejects the entire batch when any operation is invalid", () => {
    const result = validateCharacterDesignResult({
      operations: [
        { operation: "create", character: sheet("Mira") },
        { operation: "update", characterId: "missing", character: sheet("Ghost") },
      ],
    }, new Set(["kael"]));
    expect(result).toEqual({ ok: false, error: "The model did not identify a valid character to update." });
  });

  it("rejects duplicate updates and oversized batches", () => {
    const duplicate = { operation: "update", characterId: "kael", character: sheet("Kael") };
    expect(validateCharacterDesignResult({ operations: [duplicate, duplicate] }, new Set(["kael"])).ok)
      .toBe(false);
    expect(validateCharacterDesignResult({
      operations: Array.from({ length: MAX_CHARACTER_DESIGN_OPERATIONS + 1 }, (_, index) => ({
        operation: "create",
        character: sheet(`Character ${index}`),
      })),
    }, new Set()).ok).toBe(false);
  });

  it("accepts only completed operations from a streaming JSON prefix", () => {
    const prefix = `{"operations":[${JSON.stringify({
      operation: "create",
      characterId: null,
      character: sheet("Mira"),
    })},{"operation":"create","character":{"name":"Ka`;
    const partial = dropOpenArrayElement(parsePartialJson(prefix)!);
    const result = validateCharacterDesignResult(partial, new Set());
    expect(result.ok && result.updates.map((update) => update.character.name)).toEqual(["Mira"]);
  });
});
