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

  it("defaults to none and persists independently per manuscript", async () => {
    const first = await saveManuscript({ name: "Context preference one" });
    const second = await saveManuscript({ name: "Context preference two" });
    expect(first.assistantChapterContext).toBe("none");
    expect(second.assistantChapterContext).toBe("none");

    await saveManuscript({ ...first, assistantChapterContext: "summary" });
    expect((await getManuscript(first.id))?.assistantChapterContext).toBe("summary");
    expect((await getManuscript(second.id))?.assistantChapterContext).toBe("none");
  });
});
