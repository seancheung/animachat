import { v4 as uuidv4 } from "uuid";
import type {
  Manuscript,
  ManuscriptAssistantScope,
  ManuscriptChapter,
  ManuscriptCharacter,
  ManuscriptMessage,
  ManuscriptPerspective,
  ManuscriptSession,
} from "./types";

const PERSPECTIVES = new Set<ManuscriptPerspective>([
  "first",
  "third-limited",
  "third-omniscient",
  "second",
]);

const ASSISTANT_SCOPES = new Set<ManuscriptAssistantScope>([
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

export function normalizeManuscriptChapter(value: Partial<ManuscriptChapter> = {}): ManuscriptChapter {
  const t = now();
  return {
    id: text(value.id) || uid(),
    title: text(value.title, "Untitled chapter"),
    content: text(value.content),
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

export function normalizeManuscriptCharacter(
  value: Partial<ManuscriptCharacter> = {}
): ManuscriptCharacter {
  return {
    id: text(value.id) || uid(),
    name: text(value.name, "Unnamed character"),
    description: text(value.description),
    personality: text(value.personality),
    appearance: text(value.appearance),
    voice: text(value.voice),
  };
}

function normalizeMessage(value: Partial<ManuscriptMessage>): ManuscriptMessage | null {
  if (!value || !["user", "assistant", "character"].includes(String(value.role))) return null;
  return {
    role: value.role!,
    content: text(value.content),
    createdAt: timestamp(value.createdAt, now()),
  };
}

export function normalizeManuscriptSession(value: Partial<ManuscriptSession> = {}): ManuscriptSession {
  const t = now();
  const kind = value.kind === "character" ? "character" : "assistant";
  return {
    id: text(value.id) || uid(),
    title: text(value.title, "New session"),
    kind,
    ...(kind === "assistant" ? {
      scope: ASSISTANT_SCOPES.has(value.scope as ManuscriptAssistantScope)
        ? value.scope as ManuscriptAssistantScope
        : "manuscript",
    } : {}),
    characterId: kind === "character" ? text(value.characterId) || null : null,
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map(normalizeMessage)
      .filter((m): m is ManuscriptMessage => !!m),
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

/** Normalize imported/client-authored project data and repair dangling chat sessions. */
export function normalizeManuscript(
  value: Partial<Manuscript> = {},
  existing?: Manuscript | null
): Omit<Manuscript, "id" | "createdAt" | "updatedAt"> {
  const merged = { ...existing, ...value };
  const chapters = (Array.isArray(merged.chapters) ? merged.chapters : []).map(
    normalizeManuscriptChapter
  );
  const characters = (Array.isArray(merged.characters) ? merged.characters : []).map(
    normalizeManuscriptCharacter
  );
  const characterIds = new Set(characters.map((c) => c.id));
  const sessions = (Array.isArray(merged.sessions) ? merged.sessions : [])
    .map(normalizeManuscriptSession)
    .filter((s) => s.kind === "assistant" || (!!s.characterId && characterIds.has(s.characterId)));
  return {
    name: text(merged.name, "Untitled manuscript"),
    synopsis: text(merged.synopsis),
    perspective: PERSPECTIVES.has(merged.perspective as ManuscriptPerspective)
      ? (merged.perspective as ManuscriptPerspective)
      : "third-limited",
    style: text(merged.style),
    modelId: text(merged.modelId) || null,
    chapters: chapters.length ? chapters : [normalizeManuscriptChapter({ title: "Chapter 1" })],
    characters,
    sessions,
    tags: (Array.isArray(merged.tags) ? merged.tags : []).filter(
      (tag): tag is string => typeof tag === "string" && !!tag.trim()
    ),
  };
}

export function emptyManuscript(): Omit<Manuscript, "id" | "createdAt" | "updatedAt"> {
  return normalizeManuscript({});
}

export const MANUSCRIPT_PERSPECTIVE_LABELS: Record<ManuscriptPerspective, string> = {
  first: "First person",
  "third-limited": "Third person limited",
  "third-omniscient": "Third person omniscient",
  second: "Second person",
};
