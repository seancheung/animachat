"use client";

import { useEffect, useRef } from "react";
import { assetUrl } from "@/lib/ui";
import type { Character } from "@/lib/types";

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

    // autoplay is blocked until the tab's first interaction — retry on the first gesture
    let retry: (() => void) | null = null;
    const disarmRetry = () => {
      if (!retry) return;
      document.removeEventListener("pointerdown", retry);
      document.removeEventListener("keydown", retry);
      retry = null;
    };
    const play = () => {
      el.play().catch(() => {
        if (cancelled || retry) return;
        retry = () => {
          disarmRetry();
          if (!cancelled) el.play().catch(() => {});
        };
        document.addEventListener("pointerdown", retry);
        document.addEventListener("keydown", retry);
      });
    };

    const desired = enabled ? url : null;
    if (desired !== curUrl.current) {
      fadeTo(0, () => {
        el.pause();
        curUrl.current = desired;
        if (desired) {
          el.src = desired;
          play();
          fadeTo(targetVol.current);
        }
      });
    } else if (desired) {
      if (el.paused) play();
      fadeTo(targetVol.current);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      disarmRetry();
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
export const MIX = { bgm: 0.6, ambient: 0.35, blip: 0.5, emote: 0.8 };

/**
 * One-shot expression SFX (laughter, sigh…): plays when a character's DISPLAYED emotion
 * changes to one that has an SFX uploaded — never on the initial render (opening a chat
 * replays no sounds), and never when the emotion stays the same between messages.
 * Rides the sound-effects channel; browsing the backlog replays them with the sprites.
 */
export function useEmotionSfx({
  characters,
  emotions,
  volume,
  muted,
}: {
  /** the characters on stage — off-stage emotion changes make no sound */
  characters: Character[];
  /** characterId -> displayed emotion */
  emotions: Record<string, string>;
  volume: number;
  muted: boolean;
}) {
  const prev = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const last = prev.current;
    prev.current = { ...emotions };
    if (!last || muted) return;
    for (const c of characters) {
      const emo = emotions[c.id];
      if (!emo || last[c.id] === emo) continue;
      // older playthrough snapshots predate spriteSfx — fail-soft
      const url = assetUrl(c.spriteSfx?.[emo] ?? null);
      if (!url) continue;
      const el = new Audio(url);
      el.volume = Math.max(0, Math.min(1, volume * MIX.emote));
      void el.play().catch(() => {});
    }
  }, [characters, emotions, volume, muted]);
}

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
