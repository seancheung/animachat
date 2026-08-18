import { describe, expect, it } from "vitest";
import { emptyManuscript, normalizeManuscript } from "./manuscript";

describe("manuscript document", () => {
  it("starts with one usable chapter", () => {
    const manuscript = emptyManuscript();
    expect(manuscript.name).toBe("Untitled manuscript");
    expect(manuscript.perspective).toBe("third-limited");
    expect(manuscript.chapters).toHaveLength(1);
    expect(manuscript.chapters[0].title).toBe("Chapter 1");
  });

  it("repairs invalid perspective and dangling character sessions", () => {
    const manuscript = normalizeManuscript({
      perspective: "invalid" as never,
      characters: [{ id: "present", name: "Mira" } as never],
      sessions: [
        { id: "keep", kind: "character", characterId: "present", messages: [] },
        { id: "drop", kind: "character", characterId: "missing", messages: [] },
        { id: "assistant", kind: "assistant", characterId: "missing", messages: [] },
      ] as never,
    });
    expect(manuscript.perspective).toBe("third-limited");
    expect(manuscript.sessions.map((s) => s.id)).toEqual(["keep", "assistant"]);
    expect(manuscript.sessions[1].characterId).toBeNull();
    expect(manuscript.sessions[1].scope).toBe("manuscript");
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
});
