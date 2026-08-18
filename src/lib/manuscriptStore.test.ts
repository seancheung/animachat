import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_SCHEMA = `test_manuscript_store_${process.pid.toString(36)}_${Date.now().toString(36)}`;
process.env.ANIMACHAT_PG_SCHEMA = TEST_SCHEMA;

import { dropTestSchema, initTestSchema } from "./testDb";
import { getManuscript, saveManuscript } from "./store";

beforeAll(() => initTestSchema(TEST_SCHEMA));
afterAll(() => dropTestSchema(TEST_SCHEMA));

describe("manuscript assistant context preference", () => {
  it("defaults off and persists independently per manuscript", async () => {
    const first = await saveManuscript({ name: "Context preference one" });
    const second = await saveManuscript({ name: "Context preference two" });
    expect(first.assistantIncludeActiveChapter).toBe(false);
    expect(second.assistantIncludeActiveChapter).toBe(false);

    await saveManuscript({ ...first, assistantIncludeActiveChapter: true });
    expect((await getManuscript(first.id))?.assistantIncludeActiveChapter).toBe(true);
    expect((await getManuscript(second.id))?.assistantIncludeActiveChapter).toBe(false);
  });
});
