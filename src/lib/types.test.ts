import { describe, expect, it } from "vitest";
import { ATTACHMENT_CHAR_CAP, attachmentAllowances } from "@/lib/types";

const file = (len: number) => ({ text: "x".repeat(len) });

describe("attachmentAllowances", () => {
  it("files within the budget pass whole, in input order", () => {
    expect(attachmentAllowances([file(100), file(50)])).toEqual([100, 50]);
    expect(attachmentAllowances([])).toEqual([]);
  });

  it("a single file is capped at the whole budget", () => {
    expect(attachmentAllowances([file(ATTACHMENT_CHAR_CAP + 1)])).toEqual([ATTACHMENT_CHAR_CAP]);
  });

  it("grants smallest-first: small notes survive intact, the big file takes the cut", () => {
    const big = ATTACHMENT_CHAR_CAP; // would fit alone, must yield to the notes
    expect(attachmentAllowances([file(big), file(500), file(300)])).toEqual([
      ATTACHMENT_CHAR_CAP - 800,
      500,
      300,
    ]);
  });

  it("a file can be squeezed to zero once smaller ones spend the budget", () => {
    const half = ATTACHMENT_CHAR_CAP / 2;
    expect(attachmentAllowances([file(ATTACHMENT_CHAR_CAP), file(half), file(half)])).toEqual([
      0,
      half,
      half,
    ]);
  });
});
