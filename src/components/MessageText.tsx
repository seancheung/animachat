"use client";

import { Fragment, useMemo } from "react";

/**
 * Renders roleplay prose: *actions* italic/tinted, "dialogue" prominent.
 * In chat messages a single asterisk means action, not markdown emphasis.
 */
export function MessageText({ text, streaming }: { text: string; streaming?: boolean }) {
  const parts = useMemo(() => {
    const tokens: { kind: "action" | "quote" | "plain"; text: string }[] = [];
    const re = /(\*[^*\n]+\*?)|("[^"\n]*"?)|(“[^”\n]*”?)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) tokens.push({ kind: "plain", text: text.slice(last, m.index) });
      const t = m[0];
      if (t.startsWith("*")) tokens.push({ kind: "action", text: t.replace(/^\*|\*$/g, "") });
      else tokens.push({ kind: "quote", text: t });
      last = m.index + t.length;
    }
    if (last < text.length) tokens.push({ kind: "plain", text: text.slice(last) });
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
          ) : (
            <span className="whitespace-pre-wrap">{p.text}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
