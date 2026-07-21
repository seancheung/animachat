import { describe, expect, it } from "vitest";
import { computeStage } from "./stage";
import type { Chat, SceneEvent } from "./types";

/* The client folds the sparse StageEventEntry projection (event-bearing messages,
 * bodyless) where the server folds full timelines — the two must agree, at the live
 * end and at every browsed position. */

const chat = {
  mode: "story",
  characterIds: ["a", "b", "c"],
  sceneId: null,
  locationId: null,
  storySnapshot: {
    scenes: [
      { id: "s1", cast: ["a"], locationId: "l1" },
      { id: "s2", cast: ["b"], locationId: null },
    ],
    locations: [{ id: "l1" }],
    characters: [],
    lorebooks: [],
  },
} as unknown as Chat;

const stub = (position: number, sceneEvent: SceneEvent | null) => ({ position, sceneEvent });

const full = [
  stub(0, { enter: ["a"] }), // the opening narration stages the tableau — nothing is automatic
  stub(1, null),
  stub(2, { enter: ["c"] }),
  stub(3, null),
  stub(4, { sceneId: "s2", enter: ["b"] }), // transition message: the stage empties, then its enters stage the NEW scene
  stub(5, { commit: ["Kael was spared", "Kael was spared"] }), // duplicate within an event folds once
  stub(6, { reveal: ["secret1"], commit: ["The medallion went to the sea"], theEnd: true }),
];
const sparse = full.filter((m) => m.sceneEvent);

describe("computeStage over the sparse event projection", () => {
  it("matches the full-timeline fold at the live end", () => {
    expect(computeStage(chat, sparse)).toEqual(computeStage(chat, full));
    const end = computeStage(chat, sparse);
    expect(end).toEqual({
      sceneId: "s2",
      locationId: null,
      present: ["b"],
      revealed: ["secret1"],
      commitments: ["Kael was spared", "The medallion went to the sea"],
      ended: true,
    });
  });

  it("matches at every browsed position (uptoPosition)", () => {
    for (let upto = 0; upto <= 6; upto++) {
      expect(computeStage(chat, sparse, upto)).toEqual(computeStage(chat, full, upto));
    }
    // spot-check the mid-story state: the staged opening plus the mid-scene entrance
    const mid = computeStage(chat, sparse, 3);
    expect(mid.sceneId).toBe("s1");
    expect(mid.locationId).toBe("l1");
    expect([...mid.present!].sort()).toEqual(["a", "c"]);
    expect(mid.ended).toBe(false);
  });

  it("a scene opens on an empty stage — presence comes only from <enter> staging", () => {
    // before any message: nobody, even though scene s1 authors cast ["a"]
    expect(computeStage(chat, []).present).toEqual([]);
    // a scene change wipes presence; enters on the SAME message stage the new scene
    const wiped = computeStage(chat, [stub(0, { enter: ["a", "c"] }), stub(1, { sceneId: "s2" })]);
    expect(wiped.present).toEqual([]);
    const staged = computeStage(chat, [stub(0, { enter: ["a", "c"] }), stub(1, { sceneId: "s2", enter: ["c"] })]);
    expect(staged.present).toEqual(["c"]);
  });
});
