import { describe, expect, it } from "vitest";
import { extractJson } from "./client";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"next":"narrator"}')).toEqual({ next: "narrator" });
  });

  it("parses JSON inside a code fence", () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractJson('Sure! {"summary": "text", "facts": []} Hope that helps.')).toEqual({
      summary: "text",
      facts: [],
    });
  });

  it("returns null when there is no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });

  it("parses arrays", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
});
