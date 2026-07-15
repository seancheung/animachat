import { describe, expect, it } from "vitest";
import { parseTagged, TagStreamParser, type TagEvent } from "./tags";

function run(chunks: string[]): TagEvent[] {
  const p = new TagStreamParser();
  const events: TagEvent[] = [];
  for (const c of chunks) events.push(...p.feed(c));
  events.push(...p.end());
  return events;
}

function textOf(events: TagEvent[]): string {
  return events
    .filter((e): e is Extract<TagEvent, { type: "text" }> => e.type === "text")
    .map((e) => e.text)
    .join("");
}

describe("TagStreamParser", () => {
  it("parses an emotion prefix and strips it from text", () => {
    const events = run(['<emo>smug</emo>*She smiles.* "Hi."']);
    expect(events.find((e) => e.type === "emotion")).toEqual({ type: "emotion", name: "smug" });
    expect(textOf(events)).toBe('*She smiles.* "Hi."');
  });

  it("handles tags split across arbitrary chunk boundaries", () => {
    const full = '<emo>happy</emo>Hello there!<options><o>One</o><o>Two</o></options>';
    for (const size of [1, 2, 3, 5, 7]) {
      const chunks = full.match(new RegExp(`.{1,${size}}`, "gs"))!;
      const events = run(chunks);
      expect(events.find((e) => e.type === "emotion")).toEqual({ type: "emotion", name: "happy" });
      expect(events.find((e) => e.type === "options")).toEqual({ type: "options", options: ["One", "Two"] });
      expect(textOf(events)).toBe("Hello there!");
    }
  });

  it("parses next-scene with and without self-closing slash", () => {
    expect(run(["before <next-scene/> after"]).some((e) => e.type === "nextScene")).toBe(true);
    expect(run(["before <next-scene > after"]).some((e) => e.type === "nextScene")).toBe(true);
    expect(textOf(run(["before <next-scene/> after"]))).toBe("before  after");
  });

  it("parses the targeted next-scene form, stripped from text, across chunk boundaries", () => {
    const full = "The night ends. <next-scene>The Cellar Door</next-scene>";
    for (const size of [1, 4, 9]) {
      const events = run(full.match(new RegExp(`.{1,${size}}`, "gs"))!);
      expect(events.find((e) => e.type === "nextScene")).toEqual({
        type: "nextScene",
        name: "The Cellar Door",
      });
      expect(textOf(events)).toBe("The night ends. ");
    }
  });

  it("treats an unclosed targeted next-scene as the bare tag (old behavior)", () => {
    const events = run(["<next-scene>and the prose just runs on"]);
    expect(events.find((e) => e.type === "nextScene")).toEqual({ type: "nextScene" });
    expect(textOf(events)).toBe("and the prose just runs on");
  });

  it("an empty targeted next-scene is the bare tag", () => {
    expect(run(["<next-scene></next-scene>"]).find((e) => e.type === "nextScene")).toEqual({
      type: "nextScene",
    });
  });

  it("fails soft on malformed/unclosed tags", () => {
    const events = run(["<emo>never closed and then a lot of prose follows here....."]);
    expect(events.some((e) => e.type === "emotion")).toBe(false);
    expect(textOf(events)).toContain("<emo>never closed");
  });

  it("leaves unknown angle brackets as text", () => {
    const events = run(["a < b and <i>html</i> stays"]);
    expect(textOf(events)).toBe("a < b and <i>html</i> stays");
  });

  it("caps options at 4", () => {
    const events = run(["<options><o>1</o><o>2</o><o>3</o><o>4</o><o>5</o></options>"]);
    const opts = events.find((e) => e.type === "options");
    expect(opts && opts.type === "options" && opts.options.length).toBe(4);
  });

  it("falls back to line-splitting when options lack <o> items", () => {
    const events = run(["<options>\n- go left\n- go right\n</options>"]);
    expect(events.find((e) => e.type === "options")).toEqual({
      type: "options",
      options: ["go left", "go right"],
    });
  });

  it("parses enter/leave with names, stripped from text, across chunk boundaries", () => {
    const full = "The door swings open. <enter>Kael</enter>He nods. <leave>Mira</leave>";
    for (const size of [1, 3, 6]) {
      const events = run(full.match(new RegExp(`.{1,${size}}`, "gs"))!);
      expect(events.find((e) => e.type === "enter")).toEqual({ type: "enter", name: "Kael" });
      expect(events.find((e) => e.type === "leave")).toEqual({ type: "leave", name: "Mira" });
      expect(textOf(events)).toBe("The door swings open. He nods. ");
    }
  });

  it("parses reveal titles, stripped from text, across chunk boundaries", () => {
    const events = run(["The truth lands. <rev", "eal>Kael's debt</reveal>Silence follows."]);
    expect(events.find((e) => e.type === "reveal")).toEqual({ type: "reveal", name: "Kael's debt" });
    expect(textOf(events)).toBe("The truth lands. Silence follows.");
  });

  it("fails soft on an unclosed reveal tag", () => {
    const events = run(["<reveal>Kael's debt"]);
    expect(events.some((e) => e.type === "reveal")).toBe(false);
    expect(textOf(events)).toBe("<reveal>Kael's debt");
  });

  it("empty-bodied tags flush as literal text without corrupting what follows", () => {
    // regression: the parser used to consume the tag before rejecting it,
    // eating the first character of the following prose
    expect(textOf(run(["<emo></emo>Hello there"]))).toBe("<emo></emo>Hello there");
    expect(textOf(run(["Door opens. <enter> </enter>Kael nods."]))).toBe(
      "Door opens. <enter> </enter>Kael nods."
    );
    expect(textOf(run(["Prose.<options>\n\n</options>After"]))).toBe("Prose.<options>\n\n</options>After");
    for (const size of [1, 3, 7]) {
      const full = "<emo></emo>Hello";
      expect(textOf(run(full.match(new RegExp(`.{1,${size}}`, "gs"))!))).toBe(full);
    }
  });

  it("parses the-end with and without self-closing slash", () => {
    expect(run(["fin <the-end/>"]).some((e) => e.type === "theEnd")).toBe(true);
    expect(run(["fin <the-end >"]).some((e) => e.type === "theEnd")).toBe(true);
    expect(textOf(run(["fin <the-end/>"]))).toBe("fin ");
  });

  it("consumes the paired the-end form without leaking its close tag", () => {
    for (const size of [1, 5, 999]) {
      const events = run("fin <the-end>The End</the-end> after".match(new RegExp(`.{1,${size}}`, "gs"))!);
      expect(events.some((e) => e.type === "theEnd")).toBe(true);
      expect(textOf(events)).toBe("fin  after");
    }
  });

  it("fails soft on an unclosed enter tag", () => {
    const events = run(["<enter>Kael never closes and the prose just keeps going on and on..."]);
    expect(events.some((e) => e.type === "enter")).toBe(false);
    expect(textOf(events)).toContain("<enter>Kael");
  });
});

describe("parseTagged", () => {
  it("collects reveal titles", () => {
    expect(parseTagged("A. <reveal>What sleeps below</reveal> B.").reveal).toEqual(["What sleeps below"]);
  });

  it("captures the targeted next-scene payload; bare tag leaves it null", () => {
    const targeted = parseTagged("Dawn. <next-scene>Dawn: Nothing to Collect</next-scene>");
    expect(targeted.nextScene).toBe(true);
    expect(targeted.nextSceneTarget).toBe("Dawn: Nothing to Collect");
    const bare = parseTagged("Dawn. <next-scene/>");
    expect(bare.nextScene).toBe(true);
    expect(bare.nextSceneTarget).toBeNull();
  });

  it("extracts everything in one shot", () => {
    const r = parseTagged(
      '<emo>sad</emo>Some prose.<enter>Kael</enter><next-scene/><the-end/><options><o>A</o></options>'
    );
    expect(r.emotion).toBe("sad");
    expect(r.nextScene).toBe(true);
    expect(r.enter).toEqual(["Kael"]);
    expect(r.leave).toEqual([]);
    expect(r.theEnd).toBe(true);
    expect(r.options).toEqual(["A"]);
    expect(r.content).toBe("Some prose.");
  });
});
