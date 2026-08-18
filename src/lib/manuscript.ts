import { v4 as uuidv4 } from "uuid";
import { sha256 } from "js-sha256";
import type {
  Manuscript,
  ManuscriptAssistantScope,
  ManuscriptChapter,
  ManuscriptChapterContext,
  ManuscriptCharacter,
  ManuscriptConversation,
  ManuscriptConversationMessage,
  ManuscriptConversationSession,
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
const CHAPTER_CONTEXTS = new Set<ManuscriptChapterContext>(["none", "summary", "full"]);

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
    summary: text(value.summary),
    summaryContentHash: text(value.summaryContentHash) || null,
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

export function manuscriptChapterContentHash(content: string): string {
  return sha256(content);
}

export function isManuscriptChapterSummaryStale(chapter: ManuscriptChapter): boolean {
  return !!chapter.summary.trim()
    && chapter.summaryContentHash !== manuscriptChapterContentHash(chapter.content);
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
  if (!value || !["user", "assistant"].includes(String(value.role))) return null;
  return {
    role: value.role!,
    content: text(value.content),
    ...(value.applied === true ? { applied: true } : {}),
    createdAt: timestamp(value.createdAt, now()),
  };
}

export function normalizeManuscriptSession(
  value: Partial<ManuscriptSession> = {}
): ManuscriptSession | null {
  if (value.kind !== "assistant") return null;
  const t = now();
  return {
    id: text(value.id) || uid(),
    title: text(value.title, "New session"),
    kind: "assistant",
    scope: ASSISTANT_SCOPES.has(value.scope as ManuscriptAssistantScope)
      ? value.scope as ManuscriptAssistantScope
      : "manuscript",
    characterId: null,
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map(normalizeMessage)
      .filter((m): m is ManuscriptMessage => !!m),
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

export function normalizeManuscriptConversationSession(
  value: Partial<ManuscriptConversationSession> = {},
  validCharacterIds = new Set<string>()
): ManuscriptConversationSession {
  const t = now();
  return {
    id: text(value.id) || uid(),
    title: text(value.title, "New session"),
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map((message): ManuscriptConversationMessage | null => {
        if (!message || !["user", "character"].includes(String(message.role))) return null;
        const characterId = text(message.characterId) || null;
        if (message.role === "user" && characterId !== null) return null;
        if (message.role === "character" && (!characterId || !validCharacterIds.has(characterId))) return null;
        return {
          role: message.role,
          characterId,
          content: text(message.content),
          createdAt: timestamp(message.createdAt, t),
        };
      })
      .filter((message): message is ManuscriptConversationMessage => !!message),
    createdAt: timestamp(value.createdAt, t),
    updatedAt: timestamp(value.updatedAt, t),
  };
}

export function manuscriptConversationKey(characterIds: string[]): string {
  return [...new Set(characterIds)].sort().join("\u0000");
}

export function latestManuscriptConversationSession(
  conversation: ManuscriptConversation
): ManuscriptConversationSession | null {
  return conversation.sessions.reduce<ManuscriptConversationSession | null>(
    (latest, session) => !latest || session.updatedAt > latest.updatedAt ? session : latest,
    null
  );
}

export function normalizeManuscriptConversation(
  value: Partial<ManuscriptConversation> = {},
  validCharacterIds?: Set<string>
): ManuscriptConversation | null {
  const t = now();
  const requestedCharacterIds = [...new Set(
    (Array.isArray(value.characterIds) ? value.characterIds : [])
      .filter((id): id is string => typeof id === "string" && !!id)
  )];
  if (
    !requestedCharacterIds.length
    || (validCharacterIds && requestedCharacterIds.some((id) => !validCharacterIds.has(id)))
  ) return null;
  const characterIds = requestedCharacterIds.sort();
  return {
    id: text(value.id) || uid(),
    characterIds,
    chapterContext: CHAPTER_CONTEXTS.has(value.chapterContext as ManuscriptChapterContext)
      ? value.chapterContext as ManuscriptChapterContext
      : "none",
    sessions: (Array.isArray(value.sessions) ? value.sessions : []).map(
      (session) => normalizeManuscriptConversationSession(session, new Set(characterIds))
    ),
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
    .filter((session): session is ManuscriptSession => !!session);
  const conversationKeys = new Set<string>();
  const conversations = (Array.isArray(merged.conversations) ? merged.conversations : [])
    .map((conversation) => normalizeManuscriptConversation(conversation, characterIds))
    .filter((conversation): conversation is ManuscriptConversation => {
      if (!conversation) return false;
      const key = manuscriptConversationKey(conversation.characterIds);
      if (conversationKeys.has(key)) return false;
      conversationKeys.add(key);
      return true;
    });
  const requestedChapterContext = merged.assistantChapterContext;
  return {
    name: text(merged.name, "Untitled manuscript"),
    synopsis: text(merged.synopsis),
    perspective: PERSPECTIVES.has(merged.perspective as ManuscriptPerspective)
      ? (merged.perspective as ManuscriptPerspective)
      : "third-limited",
    style: text(merged.style),
    modelId: text(merged.modelId) || null,
    assistantChapterContext: CHAPTER_CONTEXTS.has(requestedChapterContext as ManuscriptChapterContext)
      ? requestedChapterContext as ManuscriptChapterContext
      : "none",
    chapters: chapters.length ? chapters : [normalizeManuscriptChapter({ title: "Chapter 1" })],
    characters,
    sessions,
    conversations,
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
