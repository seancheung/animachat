import { describe, expect, it } from "vitest";
import {
  affinityTone,
  clockTime,
  GAP_NOTE_MIN_MS,
  humanDuration,
  resumeGapMs,
  returnEligibility,
  timeAgo,
} from "./aliveness";
import { DEFAULT_ALIVENESS, OFFSCREEN_GAP_MS, type Character } from "../types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function char(id: string, aliveness: Partial<Character["aliveness"]> = {}): Character {
  return {
    id,
    name: id,
    avatarAsset: null,
    description: "",
    greeting: "",
    exampleDialogue: "",
    imagePrompt: "",
    sprites: {},
    spriteSfx: {},
    customExpressions: [],
    typingSfxAsset: null,
    trackRelationship: true,
    aliveness: { ...DEFAULT_ALIVENESS, ...aliveness },
    idleMotion: true,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

const msg = (createdAt: number, role = "user", characterId: string | null = null) => ({
  createdAt,
  role: role as "user" | "character" | "narrator" | "marker",
  characterId,
});

describe("humanDuration / timeAgo", () => {
  it("buckets coarsely across the scale", () => {
    expect(humanDuration(3 * 60 * 1000)).toBe("3 minutes");
    expect(humanDuration(HOUR)).toBe("an hour");
    expect(humanDuration(30 * HOUR)).toBe("30 hours");
    expect(humanDuration(3 * DAY)).toBe("3 days");
    expect(humanDuration(21 * DAY)).toBe("3 weeks");
    expect(humanDuration(90 * DAY)).toBe("3 months");
    expect(humanDuration(800 * DAY)).toBe("2 years");
  });
  it("dates facts, with a floor for fresh ones", () => {
    expect(timeAgo(5 * 60 * 1000)).toBe("just now");
    expect(timeAgo(3 * DAY)).toBe("3 days ago");
  });
});

describe("clockTime", () => {
  it("formats a local wall-clock moment rounded to the nearest hour", () => {
    expect(clockTime(new Date(2026, 6, 19, 21, 20))).toBe("Sunday, July 19, 2026, around 9 PM");
    expect(clockTime(new Date(2026, 6, 19, 21, 40))).toBe("Sunday, July 19, 2026, around 10 PM");
    expect(clockTime(new Date(2026, 0, 5, 0, 7))).toBe("Monday, January 5, 2026, around 12 AM");
    expect(clockTime(new Date(2026, 0, 5, 11, 45))).toBe("Monday, January 5, 2026, around 12 PM");
  });
  it("rolls the date over when rounding crosses midnight", () => {
    expect(clockTime(new Date(2026, 6, 19, 23, 40))).toBe("Monday, July 20, 2026, around 12 AM");
  });
});

describe("resumeGapMs", () => {
  const now = 100 * DAY;
  it("is 0 with no history", () => {
    expect(resumeGapMs([], now)).toBe(0);
  });
  it("measures from an idle tail to now (continuing an old chat)", () => {
    expect(resumeGapMs([msg(now - 3 * DAY)], now)).toBe(3 * DAY);
  });
  it("measures the gap a fresh tail message just closed (user resumed and sent)", () => {
    const gap = resumeGapMs([msg(now - 5 * DAY), msg(now - 1000)], now);
    expect(gap).toBe(5 * DAY - 1000);
  });
  it("a fresh tail with no predecessor is not a gap", () => {
    expect(resumeGapMs([msg(now - 1000)], now)).toBe(0);
  });
  it("mid-conversation traffic stays below the note threshold", () => {
    const gap = resumeGapMs([msg(now - 4 * 60 * 1000), msg(now - 1000)], now);
    expect(gap).toBeLessThan(GAP_NOTE_MIN_MS);
  });
});

describe("affinityTone", () => {
  it("maps the scale to distinct tones", () => {
    expect(affinityTone(-80)).toBe("openly hostile");
    expect(affinityTone(-30)).toBe("cold and distrustful");
    expect(affinityTone(0)).toContain("neutral");
    expect(affinityTone(40)).toBe("friendly and warming");
    expect(affinityTone(70)).toBe("close and at ease");
    expect(affinityTone(95)).toBe("deeply attached");
  });
});

describe("returnEligibility", () => {
  const now = 200 * DAY;
  const casual = { mode: "casual" as const, playAsNarrator: false, sceneId: null, locationId: null };
  const old = [msg(now - OFFSCREEN_GAP_MS - HOUR)];
  const noNotes = () => null;

  it("triggers for opted-in characters after the gap", () => {
    const r = returnEligibility(casual, [char("a", { offscreenLife: "context" })], old, noNotes, now);
    expect(r.generateFor.map((c) => c.id)).toEqual(["a"]);
    expect(r.texter).toBeNull(); // context mode never texts
  });

  it("names the texter when the mode is texts", () => {
    const r = returnEligibility(casual, [char("a", { offscreenLife: "texts" })], old, noNotes, now);
    expect(r.texter?.id).toBe("a");
  });

  it("stays silent below the gap, where a setting pins fiction time, and when playing the narrator", () => {
    const chars = [char("a", { offscreenLife: "texts" })];
    expect(returnEligibility(casual, chars, [msg(now - HOUR)], noNotes, now).texter).toBeNull();
    // immersive with a fixed scene/location: real time isn't fiction time
    expect(
      returnEligibility(
        { mode: "immersive", playAsNarrator: false, sceneId: "s1", locationId: null },
        chars, old, noNotes, now
      ).generateFor
    ).toEqual([]);
    expect(
      returnEligibility({ ...casual, playAsNarrator: true }, chars, old, noNotes, now).generateFor
    ).toEqual([]);
  });

  it("runs in a setting-less immersive chat — real time can be fiction time there", () => {
    const chars = [char("a", { offscreenLife: "texts" })];
    const r = returnEligibility(
      { mode: "immersive", playAsNarrator: false, sceneId: null, locationId: null },
      chars, old, noNotes, now
    );
    expect(r.generateFor.map((c) => c.id)).toEqual(["a"]);
    expect(r.texter?.id).toBe("a");
  });

  it("ignores characters with the trait off, and empty chats", () => {
    expect(returnEligibility(casual, [char("a")], old, noNotes, now).generateFor).toEqual([]);
    expect(
      returnEligibility(casual, [char("a", { offscreenLife: "texts" })], [], noNotes, now).generateFor
    ).toEqual([]);
  });

  it("treats a note newer than the tail as an already-handled return (no regen, no text)", () => {
    const chars = [char("a", { offscreenLife: "texts" })];
    const handled = returnEligibility(casual, chars, old, () => now - HOUR, now);
    expect(handled.generateFor).toEqual([]);
    expect(handled.texter).toBeNull();
    // …while a stale note regenerates
    const stale = returnEligibility(casual, chars, old, () => now - 10 * DAY, now);
    expect(stale.generateFor.length).toBe(1);
    expect(stale.texter?.id).toBe("a");
  });

  it("picks the texter who spoke most recently, falling back to order", () => {
    const chars = [char("a", { offscreenLife: "texts" }), char("b", { offscreenLife: "texts" })];
    const history = [
      msg(now - 9 * DAY, "character", "a"),
      msg(now - 8 * DAY, "character", "b"),
      msg(now - 7 * DAY, "user"),
    ];
    expect(returnEligibility(casual, chars, history, noNotes, now).texter?.id).toBe("b");
    expect(returnEligibility(casual, chars, [msg(now - 7 * DAY)], noNotes, now).texter?.id).toBe("a");
  });
});
