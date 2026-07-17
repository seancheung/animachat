"use client";

import { useMemo, type ReactNode } from "react";

/**
 * Minimal markdown renderer for co-writer replies — the assistants write generic
 * markdown (**bold**, lists, headings), not the chat's VN prose convention, so
 * MessageText would mangle them. Builds React elements, never innerHTML, so AI
 * output can't inject markup. Covers what co-writers actually emit: headings,
 * lists, blockquotes, fenced code, hr, bold/italic/inline code/links; anything
 * unrecognized (including syntax half-arrived mid-stream) renders as plain text.
 */

/** Inline spans: `code`, **bold**, *italic* / _italic_, [text](url). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(`[^`\n]+`)|(\*\*[^\n]+?\*\*(?!\*))|(\*[^*\n]+\*)|(__[^\n]+?__(?!_))|(\b_[^_\n]+_\b)|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [t, code, bold, star, dunder, under, label, url] = m;
    if (code) out.push(<code key={m.index} className="bg-base-400/50 rounded px-1 py-px text-[0.85em]">{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={m.index} className="font-semibold">{inline(bold.slice(2, -2))}</strong>);
    else if (star) out.push(<em key={m.index}>{inline(star.slice(1, -1))}</em>);
    else if (dunder) out.push(<strong key={m.index} className="font-semibold">{inline(dunder.slice(2, -2))}</strong>);
    else if (under) out.push(<em key={m.index}>{inline(under.slice(1, -1))}</em>);
    else if (label && /^https?:\/\//.test(url))
      out.push(
        <a key={m.index} href={url} target="_blank" rel="noreferrer" className="underline text-primary-400">
          {inline(label)}
        </a>
      );
    else out.push(t); // link with a non-http(s) target stays literal
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const H_CLASS = [
  "text-base font-semibold mt-3 mb-1 first:mt-0",
  "text-[0.95rem] font-semibold mt-3 mb-1 first:mt-0",
  "font-semibold mt-2.5 mb-1 first:mt-0",
  "font-semibold mt-2 mb-0.5 first:mt-0",
  "font-medium mt-2 mb-0.5 first:mt-0",
  "font-medium mt-2 mb-0.5 first:mt-0",
];

function blocks(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = src.split("\n");
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    out.push(
      // single newlines inside a paragraph stay visible line breaks (chat-style)
      <p key={out.length} className="my-1.5 first:mt-0 last:mb-0 whitespace-pre-wrap">
        {inline(para.join("\n"))}
      </p>
    );
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*```/))) {
      flush();
      const code: string[] = [];
      // an unclosed fence (still streaming) swallows to the end — it reads as code either way
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(
        <pre key={out.length} className="bg-base-500/40 border border-base-400/60 rounded-md px-2.5 py-2 my-1.5 overflow-x-auto text-xs leading-relaxed">
          <code>{code.join("\n")}</code>
        </pre>
      );
    } else if ((m = line.match(/^(#{1,6})\s+(.*)/))) {
      flush();
      const Tag = `h${m[1].length}` as "h1";
      out.push(<Tag key={out.length} className={H_CLASS[m[1].length - 1]}>{inline(m[2])}</Tag>);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push(<hr key={out.length} className="my-2 border-base-400/60" />);
    } else if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quoted.push(lines[i].replace(/^\s*> ?/, ""));
      i--;
      out.push(
        <blockquote key={out.length} className="border-l-2 border-base-400 pl-3 my-1.5 text-content-300">
          {blocks(quoted.join("\n"))}
        </blockquote>
      );
    } else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+/))) {
      flush();
      const ordered = /\d/.test(m[1]);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const it = lines[i].match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)/);
        if (it) items.push(it[1]);
        // an indented continuation line belongs to the item above it
        else if (items.length && /^\s+\S/.test(lines[i])) items[items.length - 1] += "\n" + lines[i].trim();
        else break;
      }
      i--;
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={out.length} className={`${ordered ? "list-decimal" : "list-disc"} pl-5 my-1.5 space-y-0.5`}>
          {items.map((it, j) => (
            <li key={j} className="whitespace-pre-wrap">{inline(it)}</li>
          ))}
        </List>
      );
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const nodes = useMemo(() => blocks(text), [text]);
  return <div className={streaming ? "caret" : undefined}>{nodes}</div>;
}
