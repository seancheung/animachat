import { describe, expect, it } from "vitest";
import {
  applyManuscriptChapterEdits,
  parseManuscriptAssistantFields,
} from "./manuscriptStructured";

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
  it("strictly parses direct manuscript edit proposals", () => {
    expect(parseManuscriptAssistantFields(
      "assistant",
      JSON.stringify({
        summary: "Continue the scene",
        edits: [{ operation: "append", text: "The door opened." }],
      }),
      manuscript
    )).toEqual({
      type: "manuscript-edit",
      summary: "Continue the scene",
      edits: [{ operation: "append", text: "The door opened." }],
    });
    expect(parseManuscriptAssistantFields(
      "assistant",
      JSON.stringify({
        summary: "Tighten a phrase",
        edits: [{
          operation: "replace",
          oldText: "very dark",
          text: "lightless",
          beforeContext: "The room was ",
          afterContext: ".\n\n",
        }],
      }),
      manuscript
    )).toEqual({
      type: "manuscript-edit",
      summary: "Tighten a phrase",
      edits: [{
        operation: "replace",
        oldText: "very dark",
        text: "lightless",
        beforeContext: "The room was ",
        afterContext: ".\n\n",
      }],
    });
    expect(parseManuscriptAssistantFields(
      "assistant",
      JSON.stringify({
        summary: "Add a beat around the selection",
        edits: [{ operation: "insert-before", anchor: "The bell rang.", text: "She froze. " }],
      }),
      manuscript
    )).toMatchObject({
      edits: [{ operation: "insert-before", anchor: "The bell rang.", text: "She froze. " }],
    });
    expect(parseManuscriptAssistantFields(
      "assistant",
      JSON.stringify({
        summary: "Rename the chapter",
        edits: [{ operation: "rename-chapter", title: "  The Bell  " }],
      }),
      manuscript
    )).toMatchObject({ edits: [{ operation: "rename-chapter", title: "The Bell" }] });
  });

  it("rejects malformed manuscript edit proposals", () => {
    expect(() => parseManuscriptAssistantFields(
      "assistant",
      JSON.stringify({ summary: "Delete", edits: [{ operation: "delete", text: "Gone." }] }),
      manuscript
    )).toThrow("unsupported operation");
    expect(() => parseManuscriptAssistantFields(
      "assistant",
      JSON.stringify({ summary: "", edits: [{ operation: "append", text: "More." }] }),
      manuscript
    )).toThrow("non-empty summary");
  });

  it("applies append, insertion, replacement, and deletion edits in order", () => {
    expect(applyManuscriptChapterEdits(
      { title: "Opening", content: "First line.\n\nSecond line." },
      [
        { operation: "insert-after", anchor: "First line.", text: " A new beat." },
        { operation: "replace", oldText: "Second line.", text: "Revised second line." },
        { operation: "append", text: "Final line." },
      ]
    )).toEqual({
      title: "Opening",
      content: "First line. A new beat.\n\nRevised second line.\n\nFinal line.",
    });
    expect(applyManuscriptChapterEdits(
      { title: "Opening", content: "Keep this. Remove this." },
      [{ operation: "replace", oldText: " Remove this.", text: "" }]
    )).toEqual({ title: "Opening", content: "Keep this." });
  });

  it("replaces the exact selected range", () => {
    expect(applyManuscriptChapterEdits(
      { title: "Opening", content: "Same phrase, then same phrase." },
      [{ operation: "replace-selection", text: "a chosen phrase" }],
      { text: "same phrase", start: 18, end: 29 }
    )).toEqual({ title: "Opening", content: "Same phrase, then a chosen phrase." });
    expect(() => applyManuscriptChapterEdits(
      { title: "Opening", content: "Selected text." },
      [
        { operation: "replace-selection", text: "Replacement." },
        { operation: "append", text: "More." },
      ],
      { text: "Selected text.", start: 0, end: 14 }
    )).toThrow("must be the only prose edit");
  });

  it("rejects ambiguous anchors and stale selections", () => {
    expect(() => applyManuscriptChapterEdits(
      { title: "Opening", content: "again and again." },
      [{ operation: "replace", oldText: "again", text: "once" }]
    )).toThrow("not unique");
    expect(() => applyManuscriptChapterEdits(
      { title: "Opening", content: "Current text." },
      [{ operation: "replace-selection", text: "New text." }],
      { text: "Old text.", start: 0, end: 9 }
    )).toThrow("no longer matches");
  });

  it("uses exact adjacent context to disambiguate repeated text", () => {
    expect(applyManuscriptChapterEdits(
      {
        title: "Opening",
        content: "Mira opened the door.\n\nKael closed the door.",
      },
      [{
        operation: "replace",
        oldText: "the door",
        beforeContext: "Mira opened ",
        afterContext: ".",
        text: "the iron gate",
      }]
    )).toEqual({
      title: "Opening",
      content: "Mira opened the iron gate.\n\nKael closed the door.",
    });

    expect(applyManuscriptChapterEdits(
      {
        title: "Opening",
        content: "Mira waited. The bell rang.\n\nKael waited. The bell rang.",
      },
      [{
        operation: "insert-before",
        anchor: "The bell rang.",
        beforeContext: "Mira waited. ",
        text: "She held her breath. ",
      }]
    )).toMatchObject({
      content: "Mira waited. She held her breath. The bell rang.\n\nKael waited. The bell rang.",
    });
  });

  it("rejects stale or still-ambiguous hunk context", () => {
    expect(() => applyManuscriptChapterEdits(
      { title: "Opening", content: "Mira opened the door." },
      [{
        operation: "replace",
        oldText: "the door",
        beforeContext: "Kael opened ",
        text: "the gate",
      }]
    )).toThrow("surrounding context does not match");

    expect(() => applyManuscriptChapterEdits(
      { title: "Opening", content: "Again: the door. Again: the door." },
      [{
        operation: "replace",
        oldText: "the door",
        beforeContext: "Again: ",
        text: "the gate",
      }]
    )).toThrow("include more beforeContext or afterContext");
  });

  it("renames the active chapter atomically with optional prose edits", () => {
    expect(applyManuscriptChapterEdits(
      { title: "Chapter 1", content: "Opening text." },
      [
        { operation: "rename-chapter", title: "The Arrival" },
        { operation: "append", text: "A second beat." },
      ]
    )).toEqual({
      title: "The Arrival",
      content: "Opening text.\n\nA second beat.",
    });
    expect(() => applyManuscriptChapterEdits(
      { title: "Chapter 1", content: "Opening text." },
      [{ operation: "rename-chapter", title: "Chapter 1" }]
    )).toThrow("do not change");
  });

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
