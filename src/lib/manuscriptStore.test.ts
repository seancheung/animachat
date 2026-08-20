import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_SCHEMA = `test_manuscript_store_${process.pid.toString(36)}_${Date.now().toString(36)}`;
process.env.ANIMACHAT_PG_SCHEMA = TEST_SCHEMA;

import { all } from "./db";
import { dropTestSchema, initTestSchema } from "./testDb";
import { getManuscript, saveManuscript } from "./store";

beforeAll(() => initTestSchema(TEST_SCHEMA));
afterAll(() => dropTestSchema(TEST_SCHEMA));

describe("manuscript assistant context preference", () => {
  it("drops the legacy boolean context column", async () => {
    const columns = await all<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name='manuscripts'",
      [TEST_SCHEMA]
    );
    expect(columns.map((column) => column.column_name)).not.toContain("assistant_include_active_chapter");
  });

  it("defaults to summaries and persists independently per manuscript", async () => {
    const first = await saveManuscript({ name: "Context preference one" });
    const second = await saveManuscript({ name: "Context preference two" });
    expect(first.chapterContextMode).toBe("summary");
    expect(second.chapterContextMode).toBe("summary");

    await saveManuscript({ ...first, chapterContextMode: "full" });
    expect((await getManuscript(first.id))?.chapterContextMode).toBe("full");
    expect((await getManuscript(second.id))?.chapterContextMode).toBe("summary");
  });

  it("persists chapter attachments for assistant sessions and conversations", async () => {
    const manuscript = await saveManuscript({
      name: "Attached chapters",
      characters: [{ id: "mira", name: "Mira" }] as never,
    });
    const chapterId = manuscript.chapters[0].id;
    await saveManuscript({
      ...manuscript,
      sessions: [{
        id: "settings-session",
        kind: "assistant",
        scope: "settings",
        characterId: null,
        chapterIds: [chapterId],
        messages: [],
      }] as never,
      conversations: [{
        id: "conversation",
        characterIds: ["mira"],
        chapterIds: [chapterId],
        sessions: [],
      }] as never,
    });

    const saved = await getManuscript(manuscript.id);
    expect(saved?.sessions[0].chapterIds).toEqual([chapterId]);
    expect(saved?.conversations[0].chapterIds).toEqual([chapterId]);
  });
});
