import type { ManuscriptCharacter } from "@/lib/types";

export const MAX_CHARACTER_DESIGN_OPERATIONS = 20;

export const MANUSCRIPT_CHARACTER_VOICE_INSTRUCTION =
  `The "voice" field means example dialogue: a few short, timeless lines showing how the character speaks. ` +
  `Include only the character's own utterances, one per line, with optional actions in asterisks and dialogue in quotes. ` +
  `Never use speaker labels, write another speaker's turn, or describe physical vocal qualities such as pitch, timbre, resonance, or casting.`;

export type CharacterDesignSheet = Pick<
  ManuscriptCharacter,
  "name" | "description" | "personality" | "appearance" | "voice"
>;

export interface CharacterDesignUpdate {
  characterId: string | null;
  character: CharacterDesignSheet;
}

export type CharacterDesignValidation =
  | { ok: true; message: string | null; updates: CharacterDesignUpdate[] }
  | { ok: false; error: string };

const SHEET_FIELDS = ["name", "description", "personality", "appearance", "voice"] as const;

/** Validate the model's whole character-design batch before any client mutation. */
export function validateCharacterDesignResult(
  value: unknown,
  validCharacterIds: Set<string>
): CharacterDesignValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The model did not return a valid character-design response." };
  }
  const result = value as Record<string, unknown>;
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message.trim()
    : null;
  const legacyOperation = result.operation;
  const operations = Array.isArray(result.operations)
    ? result.operations
    : legacyOperation === "create" || legacyOperation === "update"
      ? [result]
      : legacyOperation === "none"
        ? []
        : null;
  if (!operations) {
    return { ok: false, error: "The model did not return a valid character-design operation list." };
  }
  if (operations.length > MAX_CHARACTER_DESIGN_OPERATIONS) {
    return {
      ok: false,
      error: `The model returned more than ${MAX_CHARACTER_DESIGN_OPERATIONS} character operations.`,
    };
  }

  const updates: CharacterDesignUpdate[] = [];
  const updatedIds = new Set<string>();
  for (const raw of operations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "The model returned an invalid character operation." };
    }
    const operation = raw as Record<string, unknown>;
    if (operation.operation !== "create" && operation.operation !== "update") {
      return { ok: false, error: "Each character operation must be create or update." };
    }
    const character = operation.character;
    if (!character || typeof character !== "object" || Array.isArray(character)) {
      return { ok: false, error: "Each character operation must include a complete character sheet." };
    }
    const sheet = character as Record<string, unknown>;
    if (SHEET_FIELDS.some((field) => typeof sheet[field] !== "string") || !(sheet.name as string).trim()) {
      return { ok: false, error: "Each character operation must include all five character-sheet fields." };
    }

    let characterId: string | null = null;
    if (operation.operation === "update") {
      characterId = typeof operation.characterId === "string" ? operation.characterId : null;
      if (!characterId || !validCharacterIds.has(characterId)) {
        return { ok: false, error: "The model did not identify a valid character to update." };
      }
      if (updatedIds.has(characterId)) {
        return { ok: false, error: "The model tried to update the same character more than once." };
      }
      updatedIds.add(characterId);
    }

    updates.push({
      characterId,
      character: {
        name: sheet.name as string,
        description: sheet.description as string,
        personality: sheet.personality as string,
        appearance: sheet.appearance as string,
        voice: sheet.voice as string,
      },
    });
  }

  return { ok: true, message, updates };
}
