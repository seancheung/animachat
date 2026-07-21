import { describe, expect, it } from "vitest";
import { literalizeStoryTags, mergeStoryAssist } from "./storyAssist";
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
    expect(out.characters[0].innerSelf).toBe(""); // untouched fields keep their normalized default
    expect(out.characters[1].id).toBeTruthy();
    expect(doc.characters).toHaveLength(1); // pure — input untouched
  });

  it("carries an innerSelf update through the merge", () => {
    const out = mergeStoryAssist(baseDoc(), {
      characters: [{ name: "Mira", innerSelf: "hides warmth behind sarcasm" }],
    });
    expect(out.characters[0].innerSelf).toBe("hides warmth behind sarcasm");
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

  it("literalizes placeholder tags the model slips into story content", () => {
    const out = mergeStoryAssist(baseDoc(), {
      description: "The debt hangs over [story_name] and [char1_name].",
      characters: [{ name: "Kael", description: "[char_name] of Varr guards [Mira]'s tavern." }],
      scenes: [{ name: "Opening", setup: "At [loc_name], [user_name] reads the notice in [scene_name]." }],
    });
    expect(out.description).toBe("The debt hangs over The Debt and Mira.");
    expect(out.characters.find((c) => c.name === "Kael")!.description).toBe(
      "Kael of Varr guards Mira's tavern."
    );
    // the scene's own location and name resolve; user tags surface visibly
    expect(out.scenes[0].setup).toBe("At Tavern, the player reads the notice in Opening.");
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

  it("converges when a streamed partial prefix is applied before the full payload", () => {
    // the assist route streams growing snapshots of the same fields block —
    // applying a prefix and then the whole must equal applying the whole once
    const full = {
      description: "A longer premise.",
      characters: [
        { name: "Mira", description: "sharper" },
        { name: "Kael", description: "a knight with a ledger" },
      ],
      scenes: [
        { name: "The Cellar", castNames: ["Kael"], locationName: "Tavern", successors: [{ sceneName: "Dawn", hint: "if the debt stands" }] },
      ],
      secrets: [{ title: "Kael's debt", content: "He owes too.", knownByNames: ["Kael"] }],
    };
    const partial = {
      description: "A longer prem", // scalar cut mid-way — streams as it grows
      characters: [{ name: "Mira", description: "sharper" }], // Kael not complete yet
      scenes: [],
    };
    // minted per merge (fresh ids, Date.now() timestamps) — not convergence content
    const stripIds = (d: ReturnType<typeof baseDoc>) => JSON.parse(JSON.stringify(d, (k, v) => (k === "id" || k === "locationId" || k === "cast" || k === "knownBy" || k === "successors" || k === "createdAt" || k === "updatedAt" ? undefined : v)));
    const direct = mergeStoryAssist(baseDoc(), full);
    const streamed = mergeStoryAssist(mergeStoryAssist(baseDoc(), partial), full);
    expect(stripIds(streamed)).toEqual(stripIds(direct));
    // and the id-bearing links resolve identically by name
    const kael = (d: typeof direct) => d.characters.find((c) => c.name === "Kael")!.id;
    expect(streamed.scenes.find((s) => s.name === "The Cellar")!.cast).toEqual([kael(streamed)]);
    expect(direct.scenes.find((s) => s.name === "The Cellar")!.cast).toEqual([kael(direct)]);
  });
});

describe("literalizeStoryTags", () => {
  it("rewrites a library sheet's tags when the item is copied into a story", () => {
    const doc = normalizeStoryDoc({
      name: "The Debt",
      locations: [{ id: "l1", name: "The Moonlit Tavern" }],
      characters: [
        {
          id: "c1",
          name: "Mira",
          description: "[char_name] Thistledown, alchemist.",
          greeting: '*[char_name] eyes [user_name].* "The ale at [loc_name] is bad."',
        },
      ],
    });
    const out = literalizeStoryTags(doc);
    expect(out.characters[0].description).toBe("Mira Thistledown, alchemist.");
    // one location in the story → [loc_name] resolves even outside a scene
    expect(out.characters[0].greeting).toBe('*Mira eyes the player.* "The ale at The Moonlit Tavern is bad."');
  });

  it("tolerates stray spaces inside tag brackets", () => {
    const doc = normalizeStoryDoc({
      name: "The Debt",
      locations: [{ id: "l1", name: "The Moonlit Tavern" }],
      characters: [
        { id: "c1", name: "Mira", description: "[ char_name ] waits for [ user_name ] at [ loc_name ]." },
      ],
    });
    expect(literalizeStoryTags(doc).characters[0].description).toBe(
      "Mira waits for the player at The Moonlit Tavern."
    );
  });

  it("leaves unresolvable tags for the runtime's fail-soft substitution", () => {
    const doc = normalizeStoryDoc({
      name: "",
      locations: [
        { id: "l1", name: "Tavern" },
        { id: "l2", name: "Forest" },
      ],
      secrets: [{ title: "x", content: "It waits at [loc_name] in [story_name].", knownBy: [], revealHint: "" }],
    });
    // two locations and no story name — neither tag has a single literal referent
    expect(literalizeStoryTags(doc).secrets[0].content).toBe("It waits at [loc_name] in [story_name].");
  });
});
