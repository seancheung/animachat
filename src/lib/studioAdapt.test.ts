import { describe, expect, it } from "vitest";
import { normalizeManuscript } from "./manuscript";
import { normalizeStoryDoc } from "./storyDoc";
import { manuscriptToStoryDraft, storyToManuscriptDraft } from "./studioAdapt";
import type { Manuscript, Story } from "./types";

const storyFixture = (value: Partial<Story>): Story => ({
  id: "story-1",
  ...normalizeStoryDoc(value),
  tags: value.tags ?? [],
  createdAt: 1,
  updatedAt: 1,
});

const manuscriptFixture = (value: Partial<Manuscript>): Manuscript => ({
  id: "manuscript-1",
  ...normalizeManuscript(value),
  createdAt: 1,
  updatedAt: 1,
});

describe("Library adaptations", () => {
  it("creates a manuscript scaffold from an interactive story", () => {
    const source = storyFixture({
      name: "The Crossing",
      description: "Two rivals must cross a flooded city.",
      destination: "They reach the observatory.",
      scenes: [
        { name: "The Floodgate" },
        { name: "The Observatory" },
      ] as never,
    });
    const draft = storyToManuscriptDraft(source);

    expect(draft.name).toBe("The Crossing — Manuscript");
    expect(draft.synopsis).toContain("They reach the observatory.");
    expect(draft.chapters?.map((chapter) => chapter.title)).toEqual(["The Floodgate", "The Observatory"]);
  });

  it("creates an interactive scaffold without copying manuscript prose into scene setup", () => {
    const source = manuscriptFixture({
      name: "Glass Harbor",
      chapters: [{ title: "Arrival", content: "A complete chapter that should stay in the manuscript." }] as never,
    });
    const draft = manuscriptToStoryDraft(source);

    expect(draft.name).toBe("Glass Harbor — Interactive");
    expect(draft.scenes?.[0].name).toBe("Arrival");
    expect(draft.scenes?.[0].setup).toBe("");
    expect(draft.scenes?.[0].goal).toContain("without forcing");
  });
});
