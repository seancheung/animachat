"use client";

import { useEffect, useMemo, useRef } from "react";

/** Backlog (chars) that doubles the reveal rate — keeps the typewriter from falling
 *  minutes behind a fast model while still reading as typing at the configured speed. */
const CATCHUP = 400;
/** Cap a frame's delta so a backgrounded tab doesn't dump the whole buffer on return. */
const MAX_FRAME = 0.1;

/** What the typewriter has on screen right now. */
export interface Reveal {
  /** the text revealed so far */
  text: string;
  /** everything the current page allows has been typed — the reveal is parked */
  pageDone: boolean;
  /** more text exists past the current page (only ever true when paginating) */
  hasMore: boolean;
}

interface TypeState {
  buf: string;
  shown: number;
  /** fractional characters carried between frames */
  carry: number;
  raf: number;
  lastTs: number;
  /** resolver of a pending finish() */
  done: (() => void) | null;
}

/**
 * How far the reveal may go right now: the end of paragraph #pageIndex. A separator with
 * nothing after it yet isn't a page break — the next paragraph hasn't started arriving.
 */
function pageLimit(buf: string, pageIndex: number): number {
  const re = /\n{2,}/g;
  let page = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    if (page === pageIndex) {
      return buf.slice(m.index + m[0].length).trim() ? m.index : buf.length;
    }
    page++;
  }
  return buf.length;
}

/**
 * Paces streamed prose into a VN typewriter reveal. The network delivers text in bursts
 * (a whole sentence per SSE chunk), so painting chunks as they land reads as instant;
 * this drains them character by character at `speed` chars/sec instead. The rate scales
 * with the backlog, so a fast model is followed a few seconds behind rather than ignored.
 *
 * speed 0 = no animation: text is revealed as it arrives.
 *
 * When `paginate` is on (the VN dialogue box), the reveal stops at the end of the page
 * being read and waits — the reader turns the page by bumping `pageIndex`; it never
 * advances on its own. finish() therefore only resolves once they have read to the end.
 */
export function useTypewriter({
  speed,
  paginate = false,
  pageIndex = 0,
  onReveal,
}: {
  speed: number;
  paginate?: boolean;
  pageIndex?: number;
  onReveal: (r: Reveal) => void;
}) {
  const st = useRef<TypeState>({ buf: "", shown: 0, carry: 0, raf: 0, lastTs: 0, done: null });
  // latest inputs, read by the rAF loop (which outlives any single render)
  const speedRef = useRef(speed);
  const pageRef = useRef({ paginate, pageIndex });
  const revealRef = useRef(onReveal);
  useEffect(() => {
    speedRef.current = speed;
    revealRef.current = onReveal;
  });

  const api = useMemo(() => {
    /** the gate: how far the reader has allowed the reveal to go */
    const limit = () => {
      const s = st.current;
      const { paginate: on, pageIndex: page } = pageRef.current;
      return on ? pageLimit(s.buf, page) : s.buf.length;
    };

    const emit = () => {
      const s = st.current;
      const cap = limit();
      revealRef.current({
        text: s.buf.slice(0, s.shown),
        pageDone: s.shown >= cap,
        hasMore: s.buf.length > cap,
      });
    };

    const stop = () => {
      const s = st.current;
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.lastTs = 0;
      s.carry = 0;
    };

    /** typed everything there is (not merely everything this page allows) → finish() can resolve */
    const settle = () => {
      stop();
      if (st.current.shown < st.current.buf.length) return; // parked at a page break
      const resolve = st.current.done;
      st.current.done = null;
      resolve?.();
    };

    const tick = (ts: number) => {
      const s = st.current;
      s.raf = 0;
      const dt = s.lastTs ? Math.min(MAX_FRAME, (ts - s.lastTs) / 1000) : 0;
      s.lastTs = ts;
      const cap = limit();
      const backlog = cap - s.shown;
      if (backlog > 0) {
        s.carry += speedRef.current * (1 + backlog / CATCHUP) * dt;
        const n = Math.floor(s.carry);
        if (n > 0) {
          s.carry -= n;
          s.shown = Math.min(cap, s.shown + n);
          emit();
        }
      }
      if (s.shown < limit()) s.raf = requestAnimationFrame(tick);
      else settle();
    };

    const run = () => {
      const s = st.current;
      if (s.raf) return;
      if (s.shown < limit()) s.raf = requestAnimationFrame(tick);
    };

    return {
      /** Start a new message (drops anything still buffered). Rewinds the gate to page 0
       *  right away — the caller's pageIndex reset only reaches us on the next render, and
       *  the first chunks arrive before that. */
      reset() {
        stop();
        st.current.buf = "";
        st.current.shown = 0;
        st.current.done = null;
        pageRef.current = { ...pageRef.current, pageIndex: 0 };
      },
      /** Queue a freshly streamed chunk. */
      push(chunk: string) {
        const s = st.current;
        // never let the buffer begin with whitespace: the saved message is trimmed, and
        // a leading paragraph break (e.g. "<emo>x</emo>\n\nprose") would make page 0
        // empty — the paginated reveal parks there with nothing ever shown
        if (!s.buf) chunk = chunk.replace(/^\s+/, "");
        if (!chunk) return;
        s.buf += chunk;
        if (speedRef.current <= 0) {
          s.shown = limit();
          emit();
          settle();
          return;
        }
        emit(); // the chunk may have opened a new page (hasMore) even if nothing is revealed
        run();
      },
      /** The reader turned the page (or the gate moved): reveal on into it. */
      retarget() {
        const s = st.current;
        if (speedRef.current <= 0) s.shown = limit();
        emit();
        if (s.shown < limit()) run();
        else settle();
      },
      /** Resolves once the whole message has been typed out — with pagination, that means
       *  once the reader has turned to the last page and it has finished typing. */
      finish(): Promise<void> {
        const s = st.current;
        if (s.shown >= s.buf.length) return Promise.resolve();
        return new Promise<void>((resolve) => {
          s.done = resolve;
          run();
        });
      },
      /** Click mid-typing: finish typing the current page at once (VN skip). */
      skip() {
        const s = st.current;
        const cap = limit();
        if (s.shown < cap) {
          s.shown = cap;
          emit();
        }
        settle();
      },
      /** Stop / failure: reveal everything received, ignoring page gates, and let finish() go. */
      flush() {
        const s = st.current;
        if (s.shown < s.buf.length) {
          s.shown = s.buf.length;
          emit();
        }
        settle();
      },
    };
  }, []);

  // the reader turned a page (or the layout changed) — move the gate
  useEffect(() => {
    pageRef.current = { paginate, pageIndex };
    api.retarget();
  }, [paginate, pageIndex, api]);

  useEffect(() => () => api.reset(), [api]);
  return api;
}
