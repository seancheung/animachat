import { describe, expect, it } from "vitest";
import { PureChatStreamFilter, toPureChat } from "./pureChat";

describe("toPureChat", () => {
  it("strips action spans and tidies the gap they leave", () => {
    expect(toPureChat("*smiles softly* Hey, you made it!")).toBe("Hey, you made it!");
    expect(toPureChat("Sure *shrugs* whatever you say")).toBe("Sure whatever you say");
  });

  it("drops a paragraph that was only an action", () => {
    expect(toPureChat("*walks to the kitchen*\n\nWant some coffee?")).toBe("Want some coffee?");
  });

  it("leaves markdown bold alone", () => {
    expect(toPureChat("that is **not** happening")).toBe("that is **not** happening");
  });

  it("leaves an unpaired asterisk alone", () => {
    expect(toPureChat("wait* I mean it")).toBe("wait* I mean it");
    expect(toPureChat("5 * 3\nis 15")).toBe("5 * 3\nis 15");
  });

  it("unwraps a fully-quoted line", () => {
    expect(toPureChat('"Hello there."')).toBe("Hello there.");
    expect(toPureChat("“Smart quotes too.”")).toBe("Smart quotes too.");
  });

  it("unwraps a line of several quoted segments", () => {
    expect(toPureChat('"Hey." "You there?"')).toBe("Hey. You there?");
  });

  it("keeps interior quotes in mixed text — quoting someone is legitimate", () => {
    expect(toPureChat('And then she said "no way" to my face')).toBe(
      'And then she said "no way" to my face'
    );
  });

  it("unwraps per line, not per message", () => {
    expect(toPureChat('"First text."\n"Second text."')).toBe("First text.\nSecond text.");
  });

  it("handles the classic RP shape: action + quoted dialogue", () => {
    expect(toPureChat('*looks up from the still* "We\'re closed."')).toBe("We're closed.");
  });

  it("strips structured tags but keeps mentions", () => {
    expect(toPureChat("<emo>smug</emo>You wish.")).toBe("You wish.");
    expect(toPureChat("Ask <mention>Kael</mention> about it")).toBe(
      "Ask <mention>Kael</mention> about it"
    );
    expect(toPureChat("Done.<options><o>Go home</o><o>Stay</o></options>")).toBe("Done.");
    expect(toPureChat("A stray </options> marker")).toBe("A stray marker");
    expect(toPureChat("over<the-end/>")).toBe("over");
  });

  it("collapses whitespace left behind", () => {
    expect(toPureChat("a  b\n\n\n\nc")).toBe("a b\n\nc");
  });
});

describe("PureChatStreamFilter", () => {
  const run = (chunks: string[]) => {
    const f = new PureChatStreamFilter();
    return chunks.map((c) => f.feed(c)).join("") + f.end();
  };

  it("passes plain text through untouched", () => {
    expect(run(["Hey, ", "how are you?"])).toBe("Hey, how are you?");
  });

  it("drops an action span even when split across chunks", () => {
    expect(run(["*smi", "les softly* Hey"])).toBe(" Hey");
    expect(run(["Sure ", "*shr", "ugs*", " fine"])).toBe("Sure  fine");
  });

  it("holds a lone asterisk until it resolves", () => {
    const f = new PureChatStreamFilter();
    expect(f.feed("wait *")).toBe("wait ");
    expect(f.feed("here it comes")).toBe(""); // still ambiguous — no close, no newline
    expect(f.feed("*")).toBe(""); // span closed and dropped
    expect(f.end()).toBe("");
  });

  it("a newline proves the asterisk literal and flushes it", () => {
    expect(run(["2 * 3", "\nis 6"])).toBe("2 * 3\nis 6");
  });

  it("stream end proves the asterisk literal and flushes it", () => {
    expect(run(["five *stars"])).toBe("five *stars");
  });

  it("lets markdown bold through", () => {
    expect(run(["that is *", "*not*", "* happening"])).toBe("that is **not** happening");
  });
});
