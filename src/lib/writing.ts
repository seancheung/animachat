import { v4 as uuidv4 } from "uuid";
import type {
  Fiction,
  FictionAssistantScope,
  FictionChapter,
  FictionCharacter,
  FictionMessage,
  FictionSession,
  WritingPerspective,
} from "./types";

const PERSPECTIVES = new Set<WritingPerspective>([
  "first",
  "third-limited",
  "third-omniscient",
  "second",
]);

const ASSISTANT_SCOPES = new Set<FictionAssistantScope>([
  "manuscript",
  "characters",
  "settings",
]);

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const uid = () => uuidv4();
const now = () => Date.now();

const timestamp = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function normalizeFictionChapter(value: Partial<FictionChapter> = {}): FictionChapter {
  const t = now();
  return {
    id: text(value.id) || uid(),
    title: text(value.title, "Untitled chapter"),
    content: text(value.content),
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

export function normalizeFictionCharacter(
  value: Partial<FictionCharacter> = {}
): FictionCharacter {
  return {
    id: text(value.id) || uid(),
    name: text(value.name, "Unnamed character"),
    description: text(value.description),
    personality: text(value.personality),
    appearance: text(value.appearance),
    voice: text(value.voice),
  };
}

function normalizeMessage(value: Partial<FictionMessage>): FictionMessage | null {
  if (!value || !["user", "assistant", "character"].includes(String(value.role))) return null;
  return {
    role: value.role!,
    content: text(value.content),
    createdAt: timestamp(value.createdAt, now()),
  };
}

export function normalizeFictionSession(value: Partial<FictionSession> = {}): FictionSession {
  const t = now();
  const kind = value.kind === "character" ? "character" : "assistant";
  return {
    id: text(value.id) || uid(),
    title: text(value.title, "New session"),
    kind,
    ...(kind === "assistant" ? {
      scope: ASSISTANT_SCOPES.has(value.scope as FictionAssistantScope)
        ? value.scope as FictionAssistantScope
        : "manuscript",
    } : {}),
    characterId: kind === "character" ? text(value.characterId) || null : null,
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map(normalizeMessage)
      .filter((m): m is FictionMessage => !!m),
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

/** Normalize imported/client-authored project data and repair dangling chat sessions. */
export function normalizeFiction(
  value: Partial<Fiction> = {},
  existing?: Fiction | null
): Omit<Fiction, "id" | "createdAt" | "updatedAt"> {
  const merged = { ...existing, ...value };
  const chapters = (Array.isArray(merged.chapters) ? merged.chapters : []).map(
    normalizeFictionChapter
  );
  const characters = (Array.isArray(merged.characters) ? merged.characters : []).map(
    normalizeFictionCharacter
  );
  const characterIds = new Set(characters.map((c) => c.id));
  const sessions = (Array.isArray(merged.sessions) ? merged.sessions : [])
    .map(normalizeFictionSession)
    .filter((s) => s.kind === "assistant" || (!!s.characterId && characterIds.has(s.characterId)));
  return {
    name: text(merged.name, "Untitled fiction"),
    synopsis: text(merged.synopsis),
    perspective: PERSPECTIVES.has(merged.perspective as WritingPerspective)
      ? (merged.perspective as WritingPerspective)
      : "third-limited",
    writingStyle: text(merged.writingStyle),
    modelId: text(merged.modelId) || null,
    chapters: chapters.length ? chapters : [normalizeFictionChapter({ title: "Chapter 1" })],
    characters,
    sessions,
    tags: (Array.isArray(merged.tags) ? merged.tags : []).filter(
      (tag): tag is string => typeof tag === "string" && !!tag.trim()
    ),
  };
}

export function emptyFiction(): Omit<Fiction, "id" | "createdAt" | "updatedAt"> {
  return normalizeFiction({});
}

export const WRITING_PERSPECTIVE_LABELS: Record<WritingPerspective, string> = {
  first: "First person",
  "third-limited": "Third person limited",
  "third-omniscient": "Third person omniscient",
  second: "Second person",
};
