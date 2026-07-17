"use client";

import { useEffect, useMemo, useRef } from "react";

/* Paces a streamed pure-chat reply into texting bubbles — the messenger sibling of
 * the VN typewriter (typewriter.ts). A real text arrives WHOLE after the sender
 * "typed" it, so instead of revealing characters this holds each paragraph back
 * until it has fully arrived, then pops it after a typing-time delay, the typing
 * indicator bridging the gaps. Presentation only: the buffer is the full reply,
 * and Stop (flush) shows everything at once. */

/** Delay bounds: even a one-word text "takes a moment to type", and a long
 *  paragraph never stalls the conversation for more than a few seconds. */
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 3000;
/** With this many bubbles queued the delays halve — the catch-up rule, so a fast
 *  model is followed a few seconds behind rather than minutes (cf. CATCHUP in
 *  typewriter.ts). */
const BACKLOG_BUBBLES = 3;

export interface BubbleReveal {
  /** revealed text — whole bubbles only, joined by paragraph breaks */
  text: string;
  /** more of the reply is still unrevealed → the typing indicator stays up */
  pending: boolean;
}

interface PacerState {
  buf: string;
  /** how many complete bubbles are on screen */
  shown: number;
  timer: number;
  /** the stream has closed — the buffer is the whole message */
  ended: boolean;
  done: (() => void) | null;
}

/** The bubbles that have FULLY arrived: a paragraph is complete once its trailing
 *  separator has text after it (same rule as the typewriter's pageLimit — a
 *  separator with nothing following isn't a break yet), or the stream has ended. */
function completeBubbles(buf: string, ended: boolean): string[] {
  const parts = buf.split(/\n{2,}/);
  if (!ended) parts.pop(); // still arriving — never show a half-typed text
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * speed — the global typing-speed setting (chars/sec): a bubble's delay is its
 * length at that rate, clamped to [0.5s, 3s]. 0 = off, matching the typewriter:
 * no pacing, text shows as it arrives (partial bubble included).
 */
export function useBubblePacer({
  speed,
  onReveal,
}: {
  speed: number;
  onReveal: (r: BubbleReveal) => void;
}) {
  const st = useRef<PacerState>({ buf: "", shown: 0, timer: 0, ended: false, done: null });
  const speedRef = useRef(speed);
  const revealRef = useRef(onReveal);
  useEffect(() => {
    speedRef.current = speed;
    revealRef.current = onReveal;
  });

  const api = useMemo(() => {
    const emit = () => {
      const s = st.current;
      if (speedRef.current <= 0) {
        // pacing off: passthrough, like the typewriter at speed 0
        revealRef.current({ text: s.buf.trim(), pending: !s.ended });
        return;
      }
      const bubbles = completeBubbles(s.buf, s.ended);
      revealRef.current({
        text: bubbles.slice(0, s.shown).join("\n\n"),
        pending: !s.ended || s.shown < bubbles.length,
      });
    };

    const settle = () => {
      const s = st.current;
      if (!s.ended) return;
      if (speedRef.current > 0 && s.shown < completeBubbles(s.buf, true).length) return;
      const resolve = s.done;
      s.done = null;
      resolve?.();
    };

    /** Reveal the next fully-arrived bubble after its typing time, then look again. */
    const schedule = () => {
      const s = st.current;
      if (s.timer || speedRef.current <= 0) return;
      const bubbles = completeBubbles(s.buf, s.ended);
      if (s.shown >= bubbles.length) {
        settle();
        return;
      }
      const queued = bubbles.length - s.shown;
      let delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, (bubbles[s.shown].length / speedRef.current) * 1000));
      if (queued >= BACKLOG_BUBBLES) delay /= 2; // catch-up: don't fall ever further behind
      s.timer = window.setTimeout(() => {
        s.timer = 0;
        s.shown++;
        emit();
        schedule();
      }, delay);
    };

    return {
      /** Start a new reply (drops anything still buffered). */
      reset() {
        const s = st.current;
        if (s.timer) window.clearTimeout(s.timer);
        st.current = { buf: "", shown: 0, timer: 0, ended: false, done: null };
      },
      /** Queue a freshly streamed chunk. */
      push(chunk: string) {
        const s = st.current;
        if (!s.buf) chunk = chunk.replace(/^\s+/, "");
        if (!chunk) return;
        s.buf += chunk;
        if (speedRef.current <= 0) emit();
        else schedule();
      },
      /** The stream closed: the buffer is the whole message (its tail becomes the last
       *  bubble). Resolves once every bubble has been shown — pacing keeps running. */
      finish(): Promise<void> {
        const s = st.current;
        s.ended = true;
        if (speedRef.current <= 0) {
          emit();
          return Promise.resolve();
        }
        const all = completeBubbles(s.buf, true).length;
        if (s.shown >= all) {
          emit(); // pending flips off even when nothing was left to reveal
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          s.done = resolve;
          schedule();
        });
      },
      /** Stop / failure: show everything received at once and let finish() go. */
      flush() {
        const s = st.current;
        if (s.timer) window.clearTimeout(s.timer);
        s.timer = 0;
        s.ended = true;
        s.shown = completeBubbles(s.buf, true).length;
        emit();
        settle();
      },
    };
  }, []);

  useEffect(() => () => api.reset(), [api]);
  return api;
}
