"use client";

import { Fragment, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { AtSign } from "lucide-react";
import { InputBox } from "@/components/app";
import { splitAtMentions } from "@/lib/mentions";
import { cn } from "@/utils/cn";

/** The @-trigger before the caret: "@" plus a partial name (no whitespace/@ inside). */
const TRIGGER_RE = /(^|\s)@([^\s@]*)$/;

/**
 * InputBox with a messenger-style @-picker: typing "@" pops a list of the present
 * characters (plus "all"); picking inserts the exact @Name, which the server converts
 * to a <mention> tag on send. With no mentionNames it behaves as a plain InputBox.
 */
export function MentionInputBox({
  mentionNames,
  value,
  onChange,
  onKeyDown,
  textareaRef,
  ...rest
}: ComponentProps<typeof InputBox> & { mentionNames: string[] }) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<string | null>(null); // null = picker closed
  const [index, setIndex] = useState(0);

  const candidates = useMemo(() => {
    if (query === null || mentionNames.length === 0) return [];
    const q = query.toLowerCase();
    return ["all", ...mentionNames].filter((n) => n.toLowerCase().startsWith(q)).slice(0, 8);
  }, [query, mentionNames]);
  const open = candidates.length > 0;

  // chip highlighting: a styled mirror of the text goes behind the (transparent-text)
  // textarea — only when something actually matches, so the placeholder stays native
  const backdrop = useMemo(() => {
    const parts = splitAtMentions(value, mentionNames);
    if (!parts.some((p) => p.mention)) return undefined;
    return (
      <>
        {parts.map((p, i) =>
          p.mention ? (
            <span key={i} className="input-mention">
              {p.text}
            </span>
          ) : (
            <Fragment key={i}>{p.text}</Fragment>
          )
        )}
        {"​" /* keeps a trailing empty line the same height as the textarea's */}
      </>
    );
  }, [value, mentionNames]);

  const syncTrigger = (text: string) => {
    const el = innerRef.current;
    const caret = el?.selectionStart ?? text.length;
    const m = TRIGGER_RE.exec(text.slice(0, caret));
    setQuery(m ? m[2] : null);
    setIndex(0);
  };

  const pick = (name: string) => {
    const el = innerRef.current;
    if (!el) return;
    const caret = el.selectionStart;
    const m = TRIGGER_RE.exec(value.slice(0, caret));
    if (!m) return setQuery(null);
    const start = m.index + m[1].length;
    const inserted = `@${name} `;
    onChange(value.slice(0, start) + inserted + value.slice(caret));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  };

  /** The mention run a caret-adjacent deletion would eat into — mentions delete whole. */
  const mentionRunAt = (pos: number, forward: boolean): { start: number; end: number } | null => {
    let off = 0;
    for (const p of splitAtMentions(value, mentionNames)) {
      const end = off + p.text.length;
      if (p.mention && (forward ? pos >= off && pos < end : pos > off && pos <= end))
        return { start: off, end };
      off = end;
    }
    return null;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const el = innerRef.current;
      if (el && el.selectionStart === el.selectionEnd) {
        const run = mentionRunAt(el.selectionStart, e.key === "Delete");
        if (run) {
          e.preventDefault();
          onChange(value.slice(0, run.start) + value.slice(run.end));
          setQuery(null);
          requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(run.start, run.start);
          });
          return;
        }
      }
    }
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        return setIndex((i) => (i + 1) % candidates.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        return setIndex((i) => (i - 1 + candidates.length) % candidates.length);
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return pick(candidates[index]);
      }
      if (e.key === "Escape") {
        // the picker takes Esc before picture mode / drawers get it
        e.preventDefault();
        e.stopPropagation();
        return setQuery(null);
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      {open && (
        <div className="absolute bottom-full left-2 z-30 mb-1 min-w-44 max-h-56 overflow-y-auto panel py-1 shadow-(--shadow-overlay)">
          {candidates.map((n, i) => (
            <button
              key={n}
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left text-sm",
                i === index ? "bg-base-300" : "hover:bg-base-300/60"
              )}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the textarea
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(n)}
            >
              <AtSign size={12} className="shrink-0 text-content-400" />
              <span className="truncate">{n}</span>
              {n === "all" && <span className="text-xs text-content-400">everyone</span>}
            </button>
          ))}
        </div>
      )}
      <InputBox
        {...rest}
        backdrop={backdrop}
        value={value}
        onChange={(v) => {
          onChange(v);
          syncTrigger(v);
        }}
        onKeyDown={handleKeyDown}
        textareaRef={(el: HTMLTextAreaElement | null) => {
          innerRef.current = el;
          if (typeof textareaRef === "function") textareaRef(el);
          else if (textareaRef) (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }}
      />
    </div>
  );
}
