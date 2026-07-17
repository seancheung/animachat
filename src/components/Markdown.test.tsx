import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const html = (text: string, streaming?: boolean) =>
  renderToStaticMarkup(<Markdown text={text} streaming={streaming} />);

describe("Markdown (co-writer replies)", () => {
  it("renders inline bold/italic/code — the syntax co-writers actually emit", () => {
    const out = html("a **bold** move, *quiet* one, with `code` too");
    expect(out).toContain("<strong");
    expect(out).toContain("bold");
    expect(out).toContain("<em>quiet</em>");
    expect(out).toContain("<code");
    expect(out).not.toContain("**"); // consumed, not shown raw
  });

  it("nests inline styles inside bold", () => {
    expect(html("**bold *and italic***")).toContain("<em>and italic</em>");
  });

  it("renders headings, lists, blockquotes and hr", () => {
    const out = html("## Title\n\n- one\n- two\n  continued\n\n1. first\n2) second\n\n> quoted\n\n---");
    expect(out).toContain("<h2");
    expect(out).toContain("<ul");
    expect(out).toContain("<ol");
    expect(out).toContain("continued"); // indented line joins the item above
    expect(out).toContain("<blockquote");
    expect(out).toContain("<hr");
  });

  it("keeps fenced code verbatim — no inline styling inside", () => {
    const out = html("```\n**not bold**\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("**not bold**");
    expect(out).not.toContain("<strong");
  });

  it("an unclosed fence (mid-stream) still renders as code", () => {
    expect(html("```\nstill streaming")).toContain("<pre");
  });

  it("links: http(s) become anchors, anything else stays literal text", () => {
    const out = html("[docs](https://example.com) and [evil](javascript:alert(1))");
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain('href="javascript');
    expect(out).toContain("[evil](javascript:alert(1))");
  });

  it("fails soft on half-arrived syntax at the streaming tail", () => {
    const out = html("typing **now", true);
    expect(out).toContain("typing **now"); // unmatched ** renders literally
    expect(out).toContain('class="caret"');
  });

  it("never injects markup from AI output", () => {
    const out = html('<script>alert("x")</script> & <img src=x>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("keeps single newlines inside a paragraph visible", () => {
    const out = html("line one\nline two");
    expect(out).toContain("whitespace-pre-wrap");
    expect(out).toContain("line one\nline two");
  });
});
