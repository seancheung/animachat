import { describe, expect, it } from "vitest";
import {
  emptyManuscript,
  isManuscriptChapterSummaryStale,
  latestManuscriptConversationSession,
  manuscriptChapterContentHash,
  manuscriptConversationKey,
  normalizeManuscript,
  normalizeManuscriptChapter,
} from "./manuscript";

describe("manuscript document", () => {
  it("starts with one usable chapter", () => {
    const manuscript = emptyManuscript();
    expect(manuscript.name).toBe("Untitled manuscript");
    expect(manuscript.perspective).toBe("third-limited");
    expect(manuscript.assistantChapterContext).toBe("none");
    expect(manuscript.chapters).toHaveLength(1);
    expect(manuscript.chapters[0].title).toBe("Chapter 1");
    expect(manuscript.conversations).toEqual([]);
  });

  it("normalizes the manuscript-level structured-assistant chapter context", () => {
    expect(normalizeManuscript({ assistantChapterContext: "summary" })
      .assistantChapterContext).toBe("summary");
    expect(normalizeManuscript({ assistantChapterContext: "invalid" as never })
      .assistantChapterContext).toBe("none");
  });

  it("tracks chapter-summary staleness from the chapter content hash", () => {
    const content = "The original chapter.";
    const current = normalizeManuscriptChapter({
      content,
      summary: "A concise summary.",
      summaryContentHash: manuscriptChapterContentHash(content),
    });
    expect(isManuscriptChapterSummaryStale(current)).toBe(false);
    expect(isManuscriptChapterSummaryStale({ ...current, content: `${content} Revised.` })).toBe(true);
    expect(isManuscriptChapterSummaryStale({ ...current, summary: "" })).toBe(false);
  });

  it("repairs invalid perspective and drops conversations with missing characters", () => {
    const manuscript = normalizeManuscript({
      perspective: "invalid" as never,
      characters: [{ id: "present", name: "Mira" } as never],
      sessions: [
        { id: "assistant", kind: "assistant", characterId: null, messages: [] },
      ] as never,
      conversations: [
        { id: "keep", characterIds: ["present"], sessions: [] },
        { id: "drop", characterIds: ["missing"], sessions: [] },
        { id: "drop-whole-group", characterIds: ["present", "missing"], sessions: [] },
      ] as never,
    });
    expect(manuscript.perspective).toBe("third-limited");
    expect(manuscript.sessions.map((session) => session.id)).toEqual(["assistant"]);
    expect(manuscript.sessions[0].scope).toBe("manuscript");
    expect(manuscript.conversations.map((conversation) => conversation.id)).toEqual(["keep"]);
    expect(manuscript.conversations[0].includeActiveChapter).toBe(true);
  });

  it("keeps assistant histories separated by manuscript workspace", () => {
    const manuscript = normalizeManuscript({
      sessions: [
        { id: "settings", kind: "assistant", scope: "settings", messages: [] },
        { id: "characters", kind: "assistant", scope: "characters", messages: [] },
      ] as never,
    });
    expect(manuscript.sessions.map((session) => session.scope)).toEqual(["settings", "characters"]);
  });

  it("preserves whether an assistant reply applied streamed fields", () => {
    const manuscript = normalizeManuscript({
      sessions: [{
        id: "settings",
        kind: "assistant",
        scope: "settings",
        messages: [
          { role: "assistant", content: "Updated the style.", applied: true },
          { role: "assistant", content: "Let's discuss it.", applied: false },
        ],
      }] as never,
    });
    expect(manuscript.sessions[0].messages).toMatchObject([
      { content: "Updated the style.", applied: true },
      { content: "Let's discuss it." },
    ]);
    expect(manuscript.sessions[0].messages[1]).not.toHaveProperty("applied");
  });

  it("canonicalizes fixed conversation members and drops duplicate member sets", () => {
    const manuscript = normalizeManuscript({
      characters: [
        { id: "mira", name: "Mira" },
        { id: "kael", name: "Kael" },
      ] as never,
      conversations: [
        { id: "first", characterIds: ["mira", "kael", "mira"], includeActiveChapter: false, sessions: [] },
        { id: "duplicate", characterIds: ["kael", "mira"], sessions: [] },
      ] as never,
    });
    expect(manuscript.conversations).toHaveLength(1);
    expect(manuscript.conversations[0].id).toBe("first");
    expect(manuscript.conversations[0].characterIds).toEqual(["kael", "mira"]);
    expect(manuscript.conversations[0].includeActiveChapter).toBe(false);
  });

  it("keeps only author messages and individually attributed cast replies", () => {
    const manuscript = normalizeManuscript({
      characters: [{ id: "mira", name: "Mira" }] as never,
      conversations: [{
        id: "conversation",
        characterIds: ["mira"],
        includeActiveChapter: true,
        sessions: [{
          id: "session",
          messages: [
            { role: "user", characterId: null, content: "Hello" },
            { role: "character", characterId: "mira", content: "Hello, author." },
            { role: "character", characterId: null, content: "legacy combined reply" },
            { role: "character", characterId: "missing", content: "outsider" },
            { role: "assistant", characterId: null, content: "assistant history" },
          ],
        }],
      }] as never,
    });
    expect(manuscript.conversations[0].sessions[0].messages).toMatchObject([
      { role: "user", characterId: null, content: "Hello" },
      { role: "character", characterId: "mira", content: "Hello, author." },
    ]);
  });

  it("identifies duplicate conversations independent of member order", () => {
    expect(manuscriptConversationKey(["mira", "kael", "mira"]))
      .toBe(manuscriptConversationKey(["kael", "mira"]));
  });

  it("opens a conversation at its most recently updated session", () => {
    const latest = latestManuscriptConversationSession({
      id: "conversation",
      characterIds: ["mira"],
      includeActiveChapter: true,
      sessions: [
        { id: "older", title: "Older", messages: [], createdAt: 1, updatedAt: 20 },
        { id: "newer", title: "Newer", messages: [], createdAt: 10, updatedAt: 30 },
      ],
      createdAt: 1,
      updatedAt: 30,
    });
    expect(latest?.id).toBe("newer");
  });
});
