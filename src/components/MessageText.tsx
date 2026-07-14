"use client";

import { Fragment, useMemo } from "react";
import { splitMentions } from "@/lib/mentions";

/** Hide a half-arrived <mention> tag at the streaming tail so raw markup never flashes
 *  during the typewriter reveal (it completes into a chip a few characters later). */
function hidePartialMentionTail(text: string): string {
  const lastOpen = text.lastIndexOf("<mention");
  if (lastOpen !== -1) {
    const rest = text.slice(lastOpen);
    if (!/^<mention\s*\/>/.test(rest) && !/^<mention>[^<]*<\/mention>/.test(rest))
      return text.slice(0, lastOpen);
  }
  const lt = text.lastIndexOf("<");
  if (lt > text.lastIndexOf(">") && "<mention".startsWith(text.slice(lt))) return text.slice(0, lt);
  return text;
}

/**
 * Renders roleplay prose: *actions* italic/tinted, "dialogue" prominent,
 * <mention> tags as highlighted @chips.
 * In chat messages a single asterisk means action, not markdown emphasis.
 */
export function MessageText({ text: rawText, streaming }: { text: string; streaming?: boolean }) {
  const text = streaming ? hidePartialMentionTail(rawText) : rawText;
  const parts = useMemo(() => {
    const tokens: { kind: "action" | "quote" | "plain" | "mention"; text: string }[] = [];
    const re = /(\*[^*\n]+\*?)|("[^"\n]*"?)|(“[^”\n]*”?)/g;
    for (const seg of splitMentions(text)) {
      if (seg.type === "mention") {
        tokens.push({ kind: "mention", text: `@${seg.name ?? "all"}` });
        continue;
      }
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(seg.text))) {
        if (m.index > last) tokens.push({ kind: "plain", text: seg.text.slice(last, m.index) });
        const t = m[0];
        if (t.startsWith("*")) tokens.push({ kind: "action", text: t.replace(/^\*|\*$/g, "") });
        else tokens.push({ kind: "quote", text: t });
        last = m.index + t.length;
      }
      if (last < seg.text.length) tokens.push({ kind: "plain", text: seg.text.slice(last) });
    }
    return tokens;
  }, [text]);

  return (
    <span className={streaming ? "caret" : undefined}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p.kind === "action" ? (
            <span className="msg-action">{p.text}</span>
          ) : p.kind === "quote" ? (
            <span className="msg-quote">{p.text}</span>
          ) : p.kind === "mention" ? (
            <span className="msg-mention">{p.text}</span>
          ) : (
            <span className="whitespace-pre-wrap">{p.text}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
