import {
  type CharacterDesignUpdate,
  validateCharacterDesignResult,
} from "./manuscriptCharacterDesign";
import type { Manuscript } from "@/lib/types";

export type ManuscriptStructuredAssistantAction =
  | "assistant"
  | "settings-assistant"
  | "character-design";

export type ManuscriptChapterEdit =
  | { operation: "rename-chapter"; title: string }
  | { operation: "append"; text: string }
  | { operation: "replace-selection"; text: string }
  | { operation: "replace"; oldText: string; text: string }
  | { operation: "insert-before" | "insert-after"; anchor: string; text: string };

export type StructuredAssistantResult =
  | { type: "manuscript-edit"; summary: string; edits: ManuscriptChapterEdit[] }
  | { type: "settings-update"; update: { synopsis?: string; style?: string } }
  | { type: "character-updates"; updates: CharacterDesignUpdate[] }
  | { type: "none" };

/** Strict final-block parsing shared by the initial response and JSON fixup attempts. */
export function parseManuscriptAssistantFields(
  action: ManuscriptStructuredAssistantAction,
  text: string,
  manuscript: Pick<Manuscript, "characters">
): StructuredAssistantResult {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The fields block must contain a JSON object.");
  }
  if (action === "assistant") {
    const value = raw as Record<string, unknown>;
    if (typeof value.summary !== "string" || !value.summary.trim()) {
      throw new Error("The fields block must contain a non-empty summary.");
    }
    if (!Array.isArray(value.edits) || !value.edits.length || value.edits.length > 12) {
      throw new Error("The fields block must contain between 1 and 12 edits.");
    }
    const edits = value.edits.map((candidate, index): ManuscriptChapterEdit => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`Edit ${index + 1} must be an object.`);
      }
      const edit = candidate as Record<string, unknown>;
      const operation = edit.operation;
      if (operation === "rename-chapter") {
        if (typeof edit.title !== "string" || !edit.title.trim()) {
          throw new Error(`Edit ${index + 1} must contain a non-empty title.`);
        }
        return { operation, title: edit.title.trim() };
      }
      if (operation === "append" || operation === "replace-selection") {
        if (typeof edit.text !== "string" || !edit.text) {
          throw new Error(`Edit ${index + 1} must contain non-empty text.`);
        }
        return { operation, text: edit.text };
      }
      if (operation === "replace") {
        if (typeof edit.oldText !== "string" || !edit.oldText) {
          throw new Error(`Edit ${index + 1} must contain non-empty oldText.`);
        }
        if (typeof edit.text !== "string") {
          throw new Error(`Edit ${index + 1} must contain string text.`);
        }
        return { operation, oldText: edit.oldText, text: edit.text };
      }
      if (operation === "insert-before" || operation === "insert-after") {
        if (typeof edit.anchor !== "string" || !edit.anchor) {
          throw new Error(`Edit ${index + 1} must contain a non-empty anchor.`);
        }
        if (typeof edit.text !== "string" || !edit.text) {
          throw new Error(`Edit ${index + 1} must contain non-empty text.`);
        }
        return { operation, anchor: edit.anchor, text: edit.text };
      }
      throw new Error(`Edit ${index + 1} has an unsupported operation.`);
    });
    return {
      type: "manuscript-edit",
      summary: value.summary.trim(),
      edits,
    };
  }
  if (action === "settings-assistant") {
    const value = raw as Record<string, unknown>;
    const update: { synopsis?: string; style?: string } = {};
    if (typeof value.synopsis === "string") update.synopsis = value.synopsis;
    if (typeof value.style === "string") update.style = value.style;
    if (!Object.keys(update).length) {
      throw new Error("The fields block must contain a string synopsis or style field.");
    }
    return { type: "settings-update", update };
  }
  const validation = validateCharacterDesignResult(
    raw,
    new Set(manuscript.characters.map((item) => item.id))
  );
  if (!validation.ok) throw new Error(validation.error);
  return validation.updates.length
    ? { type: "character-updates", updates: validation.updates }
    : { type: "none" };
}

function uniqueMatch(value: string, needle: string, label: string): number {
  const index = value.indexOf(needle);
  if (index < 0) throw new Error(`${label} was not found in the active chapter.`);
  if (value.indexOf(needle, index + 1) >= 0) {
    throw new Error(`${label} is not unique in the active chapter; include more surrounding text.`);
  }
  return index;
}

/** Apply a validated edit batch to one immutable chapter snapshot. */
export function applyManuscriptChapterEdits(
  original: { title: string; content: string },
  edits: ManuscriptChapterEdit[],
  selection?: { text: string; start: number; end: number } | null
): { title: string; content: string } {
  const proseEdits = edits.filter((edit) => edit.operation !== "rename-chapter");
  if (proseEdits.some((edit) => edit.operation === "replace-selection") && proseEdits.length !== 1) {
    throw new Error("A selected-passage replacement must be the only prose edit in its proposal.");
  }
  if (edits.filter((edit) => edit.operation === "rename-chapter").length > 1) {
    throw new Error("A proposal may rename the active chapter only once.");
  }
  let title = original.title;
  let content = original.content;
  for (const [index, edit] of edits.entries()) {
    if (edit.operation === "rename-chapter") {
      title = edit.title;
      continue;
    }
    if (edit.operation === "append") {
      content = `${content}${content && !content.endsWith("\n") ? "\n\n" : ""}${edit.text}`;
      continue;
    }
    if (edit.operation === "replace-selection") {
      if (
        !selection
        || selection.start < 0
        || selection.end < selection.start
        || selection.end > original.content.length
        || original.content.slice(selection.start, selection.end) !== selection.text
      ) {
        throw new Error("The selected passage is missing or no longer matches the active chapter.");
      }
      content = `${original.content.slice(0, selection.start)}${edit.text}${original.content.slice(selection.end)}`;
      continue;
    }
    if (edit.operation === "replace") {
      const match = uniqueMatch(content, edit.oldText, `Edit ${index + 1} oldText`);
      content = `${content.slice(0, match)}${edit.text}${content.slice(match + edit.oldText.length)}`;
      continue;
    }
    const match = uniqueMatch(content, edit.anchor, `Edit ${index + 1} anchor`);
    const insertionPoint = edit.operation === "insert-before"
      ? match
      : match + edit.anchor.length;
    content = `${content.slice(0, insertionPoint)}${edit.text}${content.slice(insertionPoint)}`;
  }
  if (title === original.title && content === original.content) {
    throw new Error("The proposed edits do not change the active chapter.");
  }
  return { title, content };
}
