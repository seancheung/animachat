import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "./MessageText";
import { PureChatStreamFilter, toPureChat } from "@/lib/ai/pureChat";

const html = (text: string, streaming = false) =>
  renderToStaticMarkup(<MessageText text={text} streaming={streaming} />);

describe("MessageText (shared by casual, immersive and story)", () => {
  const example = "恰恰是因为**那道高墙的存在**";

  it("renders Chinese bold without action styling or leftover stars", () => {
    for (const text of [example, toPureChat(example)]) {
      const out = html(text);
      expect(out).toContain('<strong class="font-semibold">那道高墙的存在</strong>');
      expect(out).not.toContain("msg-action");
      expect(out).not.toContain("*");
    }
  });

  it("keeps bold inside dialogue and alongside actions", () => {
    const out = html('*微笑* “这是**重点**。” "Also __important__." **真的**');
    expect(out).toContain('<span class="msg-action">微笑</span>');
    expect(out).toContain('<span class="msg-quote">“这是<strong class="font-semibold">重点</strong>。”</span>');
    expect(out).toContain('<strong class="font-semibold">important</strong>');
    expect(out).toContain('<strong class="font-semibold">真的</strong>');
    expect(out).not.toContain("*");
  });

  it("does not mistake partial bold for actions at any streaming boundary", () => {
    const filter = new PureChatStreamFilter();
    let filtered = "";
    for (let i = 0; i < example.length; i++) {
      filtered += filter.feed(example[i]);
      expect(html(example.slice(0, i + 1), true)).not.toContain("msg-action");
      expect(html(filtered, true)).not.toContain("msg-action");
    }
    filtered += filter.end();
    expect(html(filtered)).toBe(html(example));
  });

  it("preserves mentions, partial mention hiding and safe text rendering", () => {
    const out = html('**重点** <mention>小明</mention> <mention/> <script>');
    expect(out).toContain('<span class="msg-mention">@小明</span>');
    expect(out).toContain('<span class="msg-mention">@all</span>');
    expect(out).toContain("&lt;script&gt;");
    expect(html("**重点**<mention>小", true)).not.toContain("&lt;mention");
    expect(html("*正在微笑", true)).toContain('class="msg-action"');
  });
});
