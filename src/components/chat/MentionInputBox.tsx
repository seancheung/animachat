"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { AtSign } from "lucide-react";
import { InputBox } from "@/components/app";
import { splitAtMentions } from "@/lib/mentions";
import { cn } from "@/utils/cn";

/** The @-trigger before the caret: "@" plus a partial name (no whitespace/@ inside). */
const TRIGGER_RE = /(^|\s)@([^\s@]*)$/;

/** Character offsets of the mention runs in a plain input text. */
function runsOf(text: string, names: string[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let off = 0;
  for (const p of splitAtMentions(text, names)) {
    if (p.mention) runs.push({ start: off, end: off + p.text.length });
    off += p.text.length;
  }
  return runs;
}

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
  const mentionRunAt = (pos: number, forward: boolean): { start: number; end: number } | null =>
    runsOf(value, mentionNames).find((r) =>
      forward ? pos >= r.start && pos < r.end : pos > r.start && pos <= r.end
    ) ?? null;

  // Chips are atomic once picked: the caret can never rest INSIDE one (arrows jump
  // across, clicks land on an edge, selections widen to whole chips), and typing flush
  // against one gets a space auto-inserted so it can't fuse into — and dissolve — the
  // name. Native listeners because InputBox doesn't forward select/beforeinput.
  const latest = useRef({ value, mentionNames, onChange });
  useEffect(() => {
    latest.current = { value, mentionNames, onChange };
  });
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const snap = () => {
      if (document.activeElement !== el) return;
      const { value, mentionNames } = latest.current;
      const runs = runsOf(value, mentionNames);
      const inside = (pos: number) => runs.find((r) => pos > r.start && pos < r.end);
      let s = el.selectionStart;
      let e = el.selectionEnd;
      let changed = false;
      if (s === e) {
        const run = inside(s);
        if (run) {
          // arrow keys are intercepted in keydown; whatever still lands inside
          // (clicks, programmatic moves) snaps to the nearest edge
          s = s - run.start <= run.end - s ? run.start : run.end;
          e = s;
          changed = true;
        }
      } else {
        const rs = inside(s);
        const re = inside(e);
        if (rs) {
          s = rs.start;
          changed = true;
        }
        if (re) {
          e = re.end;
          changed = true;
        }
      }
      if (changed) el.setSelectionRange(s, e);
    };

    const onBeforeInput = (ev: InputEvent) => {
      if (ev.isComposing || ev.inputType === "insertCompositionText" || !ev.data) return;
      const { value, mentionNames, onChange } = latest.current;
      const runs = runsOf(value, mentionNames);
      const s = el.selectionStart;
      const e = el.selectionEnd;
      const fuseLeft = runs.some((r) => r.end === s) && /^[\p{L}\p{N}_]/u.test(ev.data);
      const fuseRight = runs.some((r) => r.start === e) && /\S$/.test(ev.data);
      if (!fuseLeft && !fuseRight) return;
      ev.preventDefault();
      const insert = (fuseLeft ? " " : "") + ev.data + (fuseRight ? " " : "");
      onChange(value.slice(0, s) + insert + value.slice(e));
      const pos = s + (fuseLeft ? 1 : 0) + ev.data.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    };

    document.addEventListener("selectionchange", snap);
    el.addEventListener("beforeinput", onBeforeInput as EventListener);
    return () => {
      document.removeEventListener("selectionchange", snap);
      el.removeEventListener("beforeinput", onBeforeInput as EventListener);
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // plain arrow moves cross a chip in one step (selectionchange coalesces fast
    // presses, so direction can't be inferred there — decide it here instead)
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const el = innerRef.current;
      if (el && el.selectionStart === el.selectionEnd) {
        const next = el.selectionStart + (e.key === "ArrowRight" ? 1 : -1);
        const run = runsOf(value, mentionNames).find((r) => next > r.start && next < r.end);
        if (run) {
          e.preventDefault();
          const pos = e.key === "ArrowRight" ? run.end : run.start;
          el.setSelectionRange(pos, pos);
          return;
        }
      }
    }
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
      // the Enter that commits an IME composition must not pick a mention
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
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
