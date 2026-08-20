import {
  type CharacterDesignUpdate,
  validateCharacterDesignResult,
} from "./manuscriptCharacterDesign";
import type { Manuscript } from "@/lib/types";

export type ManuscriptStructuredAssistantAction = "settings-assistant" | "character-design";

export type StructuredAssistantResult =
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
