"use client";

import { useEffect, useMemo, useRef } from "react";

/* Paces a streamed pure-chat reply into texting bubbles — the messenger sibling of
 * the VN typewriter (typewriter.ts). A real text arrives WHOLE after the sender
 * "typed" it, so instead of revealing characters this holds each paragraph back
 * until it has fully arrived, then plays a real messenger's rhythm: a short random
 * pause before the typing indicator comes up (they read your message first), then
 * indicator → bubble → a beat with the indicator DOWN (they think about the next
 * text) → indicator → bubble…, each bubble's "typing time" jittered so the cadence
 * reads human, never metronomic. Presentation only: the buffer is the full reply,
 * and Stop (flush) shows everything at once. */

/** How fast the characters "type": a brisk human texting rate. Deliberately NOT the
 *  typing-speed setting — that is a READING rate for the VN reveal and touches nothing
 *  here; the messenger's realism isn't a tunable. */
const TYPING_CPS = 6;
/** Typing-time bounds: even a one-word text "takes a moment to type", and a long
 *  paragraph doesn't stall the conversation beyond what a real texter would. */
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 9000;
/** Each bubble's typing time is scaled by a random factor in this range — the
 *  randomness the rhythm needs (uniform delays read as a machine popping bubbles). */
const JITTER_MIN = 0.85;
const JITTER_MAX = 1.4;
/** The pause between the reply starting and the typing indicator appearing — the
 *  beat where the other side is reading what you sent. */
const REACT_MIN_MS = 400;
const REACT_MAX_MS = 1500;
/** The indicator-down beat after a bubble lands, before the indicator returns for
 *  the next one — the sender re-reading what they sent, thinking about the next. */
const THINK_MIN_MS = 300;
const THINK_MAX_MS = 1200;

export interface BubbleReveal {
  /** revealed text — whole bubbles only, joined by paragraph breaks */
  text: string;
  /** more of the reply is still unrevealed */
  pending: boolean;
  /** the typing indicator should be up — false during the reaction/thinking pauses */
  typing: boolean;
}

interface PacerState {
  buf: string;
  /** how many complete bubbles are on screen */
  shown: number;
  timer: number;
  /** an indicator-down pause is running — the reaction beat before the first bubble
   *  or the thinking beat between bubbles; bubbles wait it out */
  pausing: boolean;
  /** this reply reveals as it arrives, no pacing (regenerates — a redo, not fiction) */
  instant: boolean;
  /** the stream has closed — the buffer is the whole message */
  ended: boolean;
  done: (() => void) | null;
}

const freshState = (): PacerState => ({
  buf: "",
  shown: 0,
  timer: 0,
  pausing: false,
  instant: false,
  ended: false,
  done: null,
});

/** A bubble's jittered typing time. Module-scoped on purpose: these run in timer
 *  callbacks, never during render, and the purity lint can't see that inside the
 *  hook's closures. */
function typingTimeMs(length: number): number {
  const base = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, (length / TYPING_CPS) * 1000));
  return base * (JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN));
}

/** The random reaction pause before the typing indicator first shows. */
function reactionPauseMs(): number {
  return REACT_MIN_MS + Math.random() * (REACT_MAX_MS - REACT_MIN_MS);
}

/** The random thinking beat between one bubble and the next. */
function thinkPauseMs(): number {
  return THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS);
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
 * A bubble's typing time is its length at TYPING_CPS, clamped to [1s, 9s], then
 * jittered. Every live reply is paced; only `instant` replies (regenerates) reveal
 * as they arrive, partial bubble included.
 */
export function useBubblePacer({
  onReveal,
}: {
  onReveal: (r: BubbleReveal) => void;
}) {
  const st = useRef<PacerState>(freshState());
  const revealRef = useRef(onReveal);
  useEffect(() => {
    revealRef.current = onReveal;
  });

  const api = useMemo(() => {
    const paced = () => !st.current.instant;

    const emit = () => {
      const s = st.current;
      if (!paced()) {
        // instant reply (regenerate): passthrough, the reveal follows the stream
        revealRef.current({ text: s.buf.trim(), pending: !s.ended, typing: !s.ended });
        return;
      }
      const bubbles = completeBubbles(s.buf, s.ended);
      const pending = !s.ended || s.shown < bubbles.length;
      revealRef.current({
        text: bubbles.slice(0, s.shown).join("\n\n"),
        pending,
        typing: !s.pausing && pending,
      });
    };

    const settle = () => {
      const s = st.current;
      if (!s.ended) return;
      if (paced() && s.shown < completeBubbles(s.buf, true).length) return;
      const resolve = s.done;
      s.done = null;
      resolve?.();
    };

    /** Reveal the next fully-arrived bubble after its typing time, then — when more
     *  is still coming — dip the indicator for a thinking beat before looking again.
     *  No-ops while a pause runs — its timer calls back in here. */
    const schedule = () => {
      const s = st.current;
      if (s.timer || !paced() || s.pausing) return;
      const bubbles = completeBubbles(s.buf, s.ended);
      if (s.shown >= bubbles.length) {
        settle();
        return;
      }
      s.timer = window.setTimeout(() => {
        s.timer = 0;
        s.shown++;
        const more = !s.ended || s.shown < completeBubbles(s.buf, s.ended).length;
        if (!more) {
          emit();
          settle();
          return;
        }
        // the sent bubble sits alone a beat — the indicator returns when the
        // sender "starts typing" the next one
        s.pausing = true;
        emit();
        s.timer = window.setTimeout(() => {
          s.timer = 0;
          s.pausing = false;
          emit();
          schedule();
        }, thinkPauseMs());
      }, typingTimeMs(bubbles[s.shown].length));
    };

    const reset = () => {
      const s = st.current;
      if (s.timer) window.clearTimeout(s.timer);
      st.current = freshState();
    };

    return {
      /** Clear any leftover state (a reply that never begins). */
      reset,
      /** Start a new reply: kicks off the reaction pause — the indicator stays down
       *  until it elapses, and no bubble shows before the indicator has. `instant`
       *  (regenerates) skips all pacing: the reveal follows the stream. */
      begin({ instant = false }: { instant?: boolean } = {}) {
        reset();
        const s = st.current;
        s.instant = instant;
        if (!paced()) return;
        s.pausing = true;
        s.timer = window.setTimeout(() => {
          s.timer = 0;
          s.pausing = false;
          emit(); // the indicator comes up (even before any text has arrived)
          schedule(); // reveal whatever fully arrived during the pause
        }, reactionPauseMs());
      },
      /** Queue a freshly streamed chunk. */
      push(chunk: string) {
        const s = st.current;
        if (!s.buf) chunk = chunk.replace(/^\s+/, "");
        if (!chunk) return;
        s.buf += chunk;
        if (!paced()) emit();
        else if (!s.pausing) schedule();
      },
      /** The stream closed: the buffer is the whole message (its tail becomes the last
       *  bubble). Resolves once every bubble has been shown — pacing keeps running. */
      finish(): Promise<void> {
        const s = st.current;
        s.ended = true;
        if (!paced()) {
          emit();
          return Promise.resolve();
        }
        if (!s.pausing && s.shown >= completeBubbles(s.buf, true).length) {
          emit(); // pending flips off even when nothing was left to reveal
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          s.done = resolve;
          if (!s.pausing) schedule();
        });
      },
      /** Stop / failure: show everything received at once and let finish() go. */
      flush() {
        const s = st.current;
        if (s.timer) window.clearTimeout(s.timer);
        s.timer = 0;
        s.ended = true;
        s.pausing = false;
        s.shown = completeBubbles(s.buf, true).length;
        emit();
        settle();
      },
    };
  }, []);

  useEffect(() => () => api.reset(), [api]);
  return api;
}
