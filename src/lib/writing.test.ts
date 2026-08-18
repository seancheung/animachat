import { describe, expect, it } from "vitest";
import { emptyFiction, normalizeFiction } from "./writing";

describe("fiction writing document", () => {
  it("starts with one usable chapter", () => {
    const fiction = emptyFiction();
    expect(fiction.name).toBe("Untitled fiction");
    expect(fiction.perspective).toBe("third-limited");
    expect(fiction.chapters).toHaveLength(1);
    expect(fiction.chapters[0].title).toBe("Chapter 1");
  });

  it("repairs invalid perspective and dangling character sessions", () => {
    const fiction = normalizeFiction({
      perspective: "invalid" as never,
      characters: [{ id: "present", name: "Mira" } as never],
      sessions: [
        { id: "keep", kind: "character", characterId: "present", messages: [] },
        { id: "drop", kind: "character", characterId: "missing", messages: [] },
        { id: "assistant", kind: "assistant", characterId: "missing", messages: [] },
      ] as never,
    });
    expect(fiction.perspective).toBe("third-limited");
    expect(fiction.sessions.map((s) => s.id)).toEqual(["keep", "assistant"]);
    expect(fiction.sessions[1].characterId).toBeNull();
    expect(fiction.sessions[1].scope).toBe("manuscript");
  });

  it("keeps assistant histories separated by writing workspace", () => {
    const fiction = normalizeFiction({
      sessions: [
        { id: "settings", kind: "assistant", scope: "settings", messages: [] },
        { id: "characters", kind: "assistant", scope: "characters", messages: [] },
      ] as never,
    });
    expect(fiction.sessions.map((session) => session.scope)).toEqual(["settings", "characters"]);
  });
});
