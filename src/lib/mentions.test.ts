import { describe, expect, it } from "vitest";
import { mentionsToPlain, parseMentions, splitMentions, tagMentions } from "./mentions";

describe("tagMentions", () => {
  const names = ["Mira", "Mira Belle", "Kael"];

  it("wraps exact names, longest first, keeping canonical case", () => {
    expect(tagMentions("hey @mira belle and @KAEL", names)).toBe(
      "hey <mention>Mira Belle</mention> and <mention>Kael</mention>"
    );
  });

  it("wraps @all as the self-closing tag", () => {
    expect(tagMentions("@all gather up", names)).toBe("<mention/> gather up");
  });

  it("requires a word start and a clean end", () => {
    expect(tagMentions("mail@Kael stays, @Kaelson too", names)).toBe(
      "mail@Kael stays, @Kaelson too"
    );
  });

  it("leaves unknown @text alone", () => {
    expect(tagMentions("ping @nobody", names)).toBe("ping @nobody");
  });

  it("escapes regex metacharacters in names", () => {
    expect(tagMentions("hi @R2 (unit)", ["R2 (unit)"])).toBe("hi <mention>R2 (unit)</mention>");
  });
});

describe("parseMentions", () => {
  it("collects names and the all flag, deduped", () => {
    const r = parseMentions("<mention>Kael</mention> hi <mention>Kael</mention> <mention/>");
    expect(r).toEqual({ all: true, names: ["Kael"] });
  });

  it("handles plain text", () => {
    expect(parseMentions("no tags here @Kael")).toEqual({ all: false, names: [] });
  });
});

describe("mentionsToPlain", () => {
  it("flattens tags back to @ form", () => {
    expect(mentionsToPlain("<mention>Mira Belle</mention> and <mention/> — go")).toBe(
      "@Mira Belle and @all — go"
    );
  });
});

describe("splitMentions", () => {
  it("splits into text and mention parts", () => {
    expect(splitMentions("a <mention>Kael</mention> b <mention/>")).toEqual([
      { type: "text", text: "a " },
      { type: "mention", name: "Kael" },
      { type: "text", text: " b " },
      { type: "mention", name: null },
    ]);
  });

  it("round-trips tag-free text", () => {
    expect(splitMentions("plain")).toEqual([{ type: "text", text: "plain" }]);
  });
});
