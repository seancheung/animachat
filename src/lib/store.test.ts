import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// the store opens its connection lazily on first query — setting the env here is safe
process.env.ANIMACHAT_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "animachat-test-")),
  "test.db"
);
import { appendMessage, getMessage, saveChat, saveScene, saveStory, updateMessage } from "./store";

describe("appendMessage tail freeze", () => {
  it("collapses the previous tail's variants to the active one when a follow-up lands", () => {
    const chat = saveChat({ title: "freeze" });
    const first = appendMessage({ chatId: chat.id, role: "character", content: "take one" });
    updateMessage(first.id, {
      variants: [...first.variants, { content: "take two", emotion: "smug", options: null, createdAt: 1 }],
      activeVariant: 1,
    });

    appendMessage({ chatId: chat.id, role: "user", content: "reply" });

    const frozen = getMessage(first.id)!;
    expect(frozen.variants).toHaveLength(1);
    expect(frozen.variants[0].content).toBe("take two"); // the chosen variant survives
    expect(frozen.activeVariant).toBe(0);
  });

  it("leaves the new tail's own variants intact", () => {
    const chat = saveChat({ title: "freeze2" });
    appendMessage({ chatId: chat.id, role: "user", content: "hi" });
    const tail = appendMessage({ chatId: chat.id, role: "character", content: "a" });
    updateMessage(tail.id, {
      variants: [...tail.variants, { content: "b", emotion: null, options: null, createdAt: 1 }],
      activeVariant: 1,
    });
    expect(getMessage(tail.id)!.variants).toHaveLength(2);
  });
});

describe("saveStory scene entries", () => {
  it("normalizes missing contract/branching fields and prunes dangling/self successors", () => {
    const a = saveScene({ name: "A" });
    const b = saveScene({ name: "B" });
    const story = saveStory({
      name: "branches",
      // pre-branching shape (no pressures/successors) plus a successor list that
      // points at itself, at a scene outside the story, and at a real road
      scenes: [
        { sceneId: a.id, cast: [] },
        {
          sceneId: b.id,
          cast: [],
          successors: [
            { sceneId: b.id, hint: "self" },
            { sceneId: "not-in-story", hint: "dangling" },
            { sceneId: a.id, hint: "back to the start" },
          ],
        },
      ] as never,
    });
    expect(story.scenes[0]).toMatchObject({ goal: "", obstacles: "", exit: "", pressures: "", successors: [] });
    expect(story.scenes[1].successors).toEqual([{ sceneId: a.id, hint: "back to the start" }]);
  });
});
