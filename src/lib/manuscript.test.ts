import { describe, expect, it } from "vitest";
import {
  emptyManuscript,
  isManuscriptChapterSummaryStale,
  latestManuscriptConversationSession,
  manuscriptChapterContentHash,
  manuscriptConversationKey,
  manuscriptSelectionMatches,
  normalizeManuscript,
  normalizeManuscriptChapter,
  retryableManuscriptAssistantTurn,
  truncateManuscriptAssistantAtUserMessage,
} from "./manuscript";

describe("manuscript document", () => {
  it("starts with one usable chapter", () => {
    const manuscript = emptyManuscript();
    expect(manuscript.name).toBe("Untitled manuscript");
    expect(manuscript.perspective).toBe("third-limited");
    expect(manuscript.chapterContextMode).toBe("summary");
    expect(manuscript.chapters).toHaveLength(1);
    expect(manuscript.chapters[0].title).toBe("Chapter 1");
    expect(manuscript.conversations).toEqual([]);
  });

  it("normalizes the manuscript-level structured-assistant chapter context", () => {
    expect(normalizeManuscript({ chapterContextMode: "full" })
      .chapterContextMode).toBe("full");
    expect(normalizeManuscript({ chapterContextMode: "invalid" as never })
      .chapterContextMode).toBe("summary");
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
    expect(manuscript.sessions[0].chapterIds).toEqual([]);
    expect(manuscript.conversations.map((conversation) => conversation.id)).toEqual(["keep"]);
    expect(manuscript.conversations[0].chapterIds).toEqual([]);
  });

  it("keeps assistant histories separated by manuscript workspace", () => {
    const manuscript = normalizeManuscript({
      chapters: [
        { id: "keep", title: "Keep" },
        { id: "also-keep", title: "Also keep" },
      ] as never,
      sessions: [
        {
          id: "settings",
          kind: "assistant",
          scope: "settings",
          chapterIds: ["also-keep", "missing", "keep", "keep"],
          messages: [],
        },
        { id: "characters", kind: "assistant", scope: "characters", messages: [] },
      ] as never,
    });
    expect(manuscript.sessions.map((session) => session.scope)).toEqual(["settings", "characters"]);
    expect(manuscript.sessions[0].chapterIds).toEqual(["also-keep", "keep"]);
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

  it("preserves rejected assistant edits without overriding accepted ones", () => {
    const manuscript = normalizeManuscript({
      sessions: [{
        id: "manuscript",
        kind: "assistant",
        scope: "manuscript",
        messages: [
          { role: "assistant", content: "Rejected proposal", rejected: true },
          { role: "assistant", content: "Accepted proposal", applied: true, rejected: true },
        ],
      }] as never,
    });
    expect(manuscript.sessions[0].messages[0].rejected).toBe(true);
    expect(manuscript.sessions[0].messages[1].applied).toBe(true);
    expect(manuscript.sessions[0].messages[1].rejected).toBeUndefined();
  });

  it("preserves retryable structured-data failures", () => {
    const manuscript = normalizeManuscript({
      sessions: [{
        id: "settings",
        kind: "assistant",
        scope: "settings",
        messages: [
          { role: "assistant", content: "Try again", retryable: true },
          { role: "assistant", content: "Applied", applied: true, retryable: true },
        ],
      }] as never,
    });
    expect(manuscript.sessions[0].messages[0].retryable).toBe(true);
    expect(manuscript.sessions[0].messages[1].applied).toBe(true);
    expect(manuscript.sessions[0].messages[1].retryable).toBeUndefined();
  });

  it("deletes an assistant user message and every message after it", () => {
    const messages = [
      { role: "user" as const, content: "First", createdAt: 1 },
      { role: "assistant" as const, content: "First reply", createdAt: 2 },
      { role: "user" as const, content: "Second", createdAt: 3 },
      { role: "assistant" as const, content: "Second reply", createdAt: 4 },
    ];
    expect(truncateManuscriptAssistantAtUserMessage(messages, 2))
      .toEqual(messages.slice(0, 2));
    expect(truncateManuscriptAssistantAtUserMessage(messages, 1)).toBe(messages);
  });

  it("retries only a retryable failure at the end without duplicating its user turn", () => {
    const messages = [
      { role: "user" as const, content: "First", createdAt: 1 },
      { role: "assistant" as const, content: "First reply", createdAt: 2 },
      { role: "user" as const, content: "Make the change", createdAt: 3 },
      { role: "assistant" as const, content: "Invalid data", retryable: true, createdAt: 4 },
    ];
    expect(retryableManuscriptAssistantTurn(messages)).toEqual({
      prompt: "Make the change",
      history: messages.slice(0, -1),
    });
    expect(retryableManuscriptAssistantTurn(messages.slice(0, -1))).toBeNull();
    expect(retryableManuscriptAssistantTurn([
      ...messages,
      { role: "user", content: "Later turn", createdAt: 5 },
    ])).toBeNull();
  });

  it("detects when a captured chapter selection became stale", () => {
    const selection = { text: "selected", start: 7, end: 15 };
    expect(manuscriptSelectionMatches("Before selected after.", selection)).toBe(true);
    expect(manuscriptSelectionMatches("Before revised after.", selection)).toBe(false);
    expect(manuscriptSelectionMatches("Inserted Before selected after.", selection)).toBe(false);
  });

  it("canonicalizes fixed conversation members and drops duplicate member sets", () => {
    const manuscript = normalizeManuscript({
      chapters: [{ id: "chapter", title: "Chapter" }] as never,
      characters: [
        { id: "mira", name: "Mira" },
        { id: "kael", name: "Kael" },
      ] as never,
      conversations: [
        {
          id: "first",
          characterIds: ["mira", "kael", "mira"],
          chapterIds: ["chapter", "missing", "chapter"],
          sessions: [],
        },
        { id: "duplicate", characterIds: ["kael", "mira"], sessions: [] },
      ] as never,
    });
    expect(manuscript.conversations).toHaveLength(1);
    expect(manuscript.conversations[0].id).toBe("first");
    expect(manuscript.conversations[0].characterIds).toEqual(["kael", "mira"]);
    expect(manuscript.conversations[0].chapterIds).toEqual(["chapter"]);
  });

  it("keeps only author messages and individually attributed cast replies", () => {
    const manuscript = normalizeManuscript({
      characters: [{ id: "mira", name: "Mira" }] as never,
      conversations: [{
        id: "conversation",
        characterIds: ["mira"],
        chapterIds: [],
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
      chapterIds: [],
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
