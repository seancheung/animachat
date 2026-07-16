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
  stub(0, null), // narrator prose, no events
  stub(1, null),
  stub(2, { enter: ["c"] }),
  stub(3, null),
  stub(4, { sceneId: "s2" }),
  stub(5, null),
  stub(6, { reveal: ["secret1"], theEnd: true }),
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
      ended: true,
    });
  });

  it("matches at every browsed position (uptoPosition)", () => {
    for (let upto = 0; upto <= 6; upto++) {
      expect(computeStage(chat, sparse, upto)).toEqual(computeStage(chat, full, upto));
    }
    // spot-check the mid-story state: scene 1's cast plus the staged entrance
    const mid = computeStage(chat, sparse, 3);
    expect(mid.sceneId).toBe("s1");
    expect(mid.locationId).toBe("l1");
    expect([...mid.present!].sort()).toEqual(["a", "c"]);
    expect(mid.ended).toBe(false);
  });
});
