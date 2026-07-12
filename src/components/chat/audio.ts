"use client";

import { useEffect, useRef } from "react";

/** One looping audio layer with fade-crossfade on source change. */
function useAudioLayer(url: string | null, volume: number, enabled: boolean) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const curUrl = useRef<string | null>(null);
  const targetVol = useRef(volume);
  targetVol.current = enabled ? volume : 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!elRef.current) {
      elRef.current = new Audio();
      elRef.current.loop = true;
      elRef.current.volume = 0;
    }
    const el = elRef.current;
    let raf = 0;
    let cancelled = false;

    const fadeTo = (target: number, then?: () => void) => {
      const step = () => {
        if (cancelled) return;
        const diff = target - el.volume;
        if (Math.abs(diff) < 0.03) {
          el.volume = target;
          then?.();
          return;
        }
        el.volume = Math.max(0, Math.min(1, el.volume + Math.sign(diff) * 0.03));
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const desired = enabled ? url : null;
    if (desired !== curUrl.current) {
      fadeTo(0, () => {
        el.pause();
        curUrl.current = desired;
        if (desired) {
          el.src = desired;
          el.play().catch(() => {});
          fadeTo(targetVol.current);
        }
      });
    } else if (desired) {
      if (el.paused) el.play().catch(() => {});
      fadeTo(targetVol.current);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [url, volume, enabled]);

  // pause on unmount
  useEffect(
    () => () => {
      elRef.current?.pause();
      elRef.current = null;
      curUrl.current = null;
    },
    []
  );
}

/** Typing blip via WebAudio for low latency; slight rate variation, throttled. */
export function useBlip() {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const lastPlay = useRef(0);

  async function ensureBuffer(url: string): Promise<AudioBuffer | null> {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    const cached = buffers.current.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url);
      const buf = await ctxRef.current.decodeAudioData(await res.arrayBuffer());
      buffers.current.set(url, buf);
      return buf;
    } catch {
      return null;
    }
  }

  function play(url: string, volume: number) {
    const nowMs = performance.now();
    if (nowMs - lastPlay.current < 65) return;
    lastPlay.current = nowMs;
    void ensureBuffer(url).then((buf) => {
      const ctx = ctxRef.current;
      if (!buf || !ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.92 + Math.random() * 0.18;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(ctx.destination);
      src.start();
    });
  }

  return { play, warm: ensureBuffer };
}

/** Per-channel trims, so the two sliders sit at comparable loudness at the same value. */
export const MIX = { bgm: 0.6, ambient: 0.35, blip: 0.5 };

/**
 * Two channels: music (the scene/location BGM) and sound effects (the ambient loop —
 * and, at the call site, the typing blips). A single mute covers both.
 */
export function useChatAudio({
  bgmUrl,
  ambientUrl,
  bgmVolume,
  sfxVolume,
  muted,
}: {
  bgmUrl: string | null;
  ambientUrl: string | null;
  bgmVolume: number;
  sfxVolume: number;
  muted: boolean;
}) {
  useAudioLayer(bgmUrl, bgmVolume * MIX.bgm, !muted);
  useAudioLayer(ambientUrl, sfxVolume * MIX.ambient, !muted);
}
