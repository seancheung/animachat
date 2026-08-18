import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("counts whitespace-delimited words", () => {
    expect(countWords("A short manuscript chapter.")).toBe(4);
    expect(countWords("  line one\nline two  ")).toBe(4);
  });

  it("segments Chinese without relying on spaces", () => {
    expect(countWords("你好，世界！")).toBe(2);
    expect(countWords("今天天气很好。")).toBe(3);
  });

  it("counts mixed Chinese and Latin content", () => {
    expect(countWords("这是 a short story。再见！")).toBe(6);
    expect(countWords("AnimaChat很好用")).toBe(3);
  });

  it("segments other scripts that do not always use spaces", () => {
    expect(countWords("これは日本語の文章です。")).toBe(6);
    expect(countWords("ภาษาไทยไม่มีการเว้นวรรค")).toBe(6);
  });

  it("counts words in other space-delimited scripts", () => {
    expect(countWords("هذا نص عربي قصير.")).toBe(4);
    expect(countWords("Ceci est une courte phrase.")).toBe(5);
  });

  it("does not count whitespace, punctuation, or emoji", () => {
    expect(countWords(" \n… — 🎉 ")).toBe(0);
  });
});
