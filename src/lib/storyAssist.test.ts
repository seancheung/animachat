import { describe, expect, it } from "vitest";
import { mergeStoryAssist } from "./storyAssist";
import { normalizeStoryDoc } from "./storyDoc";

/** A small existing draft: one character, one location, two scenes, one secret. */
function baseDoc() {
  return normalizeStoryDoc({
    name: "The Debt",
    description: "A night of debts.",
    characters: [{ id: "c1", name: "Mira" }],
    locations: [{ id: "l1", name: "Tavern" }],
    scenes: [
      { id: "s1", name: "Opening", cast: ["c1"], locationId: "l1" },
      { id: "s2", name: "Dawn", cast: ["c1"] },
    ],
    secrets: [{ id: "x1", title: "The cellar", content: "Moonmilk below.", knownBy: ["c1"], revealHint: "" }],
  });
}

describe("mergeStoryAssist", () => {
  it("updates items by name and appends new ones with fresh ids", () => {
    const doc = baseDoc();
    const out = mergeStoryAssist(doc, {
      description: "A longer premise.",
      characters: [
        { name: "Mira", description: "sharper" }, // update in place
        { name: "Kael", description: "a knight" }, // new — appended
      ],
    });
    expect(out.description).toBe("A longer premise.");
    expect(out.characters.map((c) => c.name)).toEqual(["Mira", "Kael"]);
    expect(out.characters[0].id).toBe("c1"); // update keeps the id
    expect(out.characters[0].description).toBe("sharper");
    expect(out.characters[1].id).toBeTruthy();
    expect(doc.characters).toHaveLength(1); // pure — input untouched
  });

  it("renames via renameFrom instead of duplicating", () => {
    const out = mergeStoryAssist(baseDoc(), {
      characters: [{ name: "Mirabel", renameFrom: "Mira" }],
    });
    expect(out.characters.map((c) => c.name)).toEqual(["Mirabel"]);
    expect(out.characters[0].id).toBe("c1");
  });

  it("resolves scene name links (location, cast, successors) within the document", () => {
    const out = mergeStoryAssist(baseDoc(), {
      characters: [{ name: "Kael" }],
      locations: [{ name: "Cellar" }],
      scenes: [
        {
          name: "Midnight",
          setup: "The cellar door stands open.",
          locationName: "Cellar",
          castNames: ["Mira", "Kael", "Nobody Known"],
          goal: "truths out",
          successors: [
            { sceneName: "Dawn", hint: "if the debt stands" },
            { sceneName: "No Such Scene", hint: "dropped" },
          ],
        },
      ],
    });
    const midnight = out.scenes.find((s) => s.name === "Midnight")!;
    const kaelId = out.characters.find((c) => c.name === "Kael")!.id;
    const cellarId = out.locations.find((l) => l.name === "Cellar")!.id;
    expect(midnight.locationId).toBe(cellarId);
    expect(midnight.cast).toEqual(["c1", kaelId]); // unknown names drop fail-soft
    expect(midnight.goal).toBe("truths out");
    expect(midnight.successors).toEqual([{ sceneId: "s2", hint: "if the debt stands" }]);
    // untouched scenes keep their fields
    expect(out.scenes.find((s) => s.name === "Opening")).toMatchObject({ locationId: "l1", cast: ["c1"] });
  });

  it("applies castOrder/sceneOrder by name, keeping unnamed leftovers", () => {
    const out = mergeStoryAssist(baseDoc(), {
      characters: [{ name: "Kael" }],
      castOrder: ["Kael", "Mira"],
      sceneOrder: ["Dawn"], // Opening not named — keeps relative order at the end
    });
    expect(out.characters.map((c) => c.name)).toEqual(["Kael", "Mira"]);
    expect(out.scenes.map((s) => s.name)).toEqual(["Dawn", "Opening"]);
  });

  it("merges secrets by title and resolves knownByNames", () => {
    const out = mergeStoryAssist(baseDoc(), {
      characters: [{ name: "Kael" }],
      secrets: [
        { title: "The cellar", knownByNames: ["Kael"] }, // update: content kept, holders replaced
        { title: "Kael's debt", content: "He owes too.", knownByNames: ["Kael"], revealHint: "grey gloves" },
      ],
    });
    const kaelId = out.characters.find((c) => c.name === "Kael")!.id;
    expect(out.secrets).toHaveLength(2);
    expect(out.secrets[0]).toMatchObject({ title: "The cellar", content: "Moonmilk below.", knownBy: [kaelId] });
    expect(out.secrets[1]).toMatchObject({ title: "Kael's debt", content: "He owes too.", knownBy: [kaelId] });
  });
});
