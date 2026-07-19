import type { Character, Chat, Message } from "@/lib/types";
import { alivenessOf, OFFSCREEN_GAP_MS } from "@/lib/types";

/* Pure helpers for the character-aliveness features (initiative, time awareness,
 * state of mind, off-screen life). Everything here is deterministic and
 * side-effect-free — the prompt builders and the return pass compose these. */

/** A conversation gap smaller than this is just conversation, not "time passing". */
export const GAP_NOTE_MIN_MS = 3 * 60 * 60 * 1000;

/**
 * Where the real-time aliveness traits (time awareness, off-screen life) apply:
 * casual chats (texting someone real — wall-clock time IS the fiction's time) and
 * setting-less immersive chats. A fixed scene or location pins the fiction to its
 * own moment, and playthrough time belongs to the story's director and narrator.
 */
export function realTimeApplies(chat: Pick<Chat, "mode" | "sceneId" | "locationId">): boolean {
  return chat.mode === "casual" || (chat.mode === "immersive" && !chat.sceneId && !chat.locationId);
}

/** A tail message younger than this means the user is here right now — the gap
 *  that matters is then the one the tail message itself closed. */
const TAIL_IS_LIVE_MS = 10 * 60 * 1000;

/** Coarse human duration — prompt material, so buckets beat precision. */
export function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return minutes <= 1 ? "a moment" : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "an hour" : `${hours} hours`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} days`;
  const weeks = Math.round(days / 7);
  if (days < 60) return `${weeks} weeks`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} months`;
  return `${Math.round(months / 12)} years`;
}

/** "3 days ago" / "just now" — for dating remembered facts. */
export function timeAgo(ms: number): string {
  if (ms < 60 * 60 * 1000) return "just now";
  return `${humanDuration(ms)} ago`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Saturday, July 19, 2026, around 9 PM" — the wall clock as prompt material
 *  (time awareness), rounded to the nearest hour: precise enough for the fiction,
 *  coarse enough that the system prompt only changes hourly (a minute clock would
 *  bust provider prefix caching on every turn). The whole timestamp is rounded,
 *  so a late-night hour rolls the date over with it. Server-local time, which
 *  today is the user's own machine; per-user time zones are a multi-user-migration
 *  concern. Hand-assembled so the format doesn't drift with the runtime's ICU. */
export function clockTime(date: Date): string {
  const d = new Date(date.getTime() + 30 * 60 * 1000);
  const h12 = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? "AM" : "PM";
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, around ${h12} ${ampm}`;
}

/**
 * The real-time gap the conversation just resumed across, in ms (0 = none).
 * If the newest message is old, the user is returning to an idle chat right now;
 * if it is fresh (they just sent it / a reply just landed), the gap that matters
 * is the one between it and the message before it.
 */
export function resumeGapMs(messages: Pick<Message, "createdAt">[], now: number): number {
  const last = messages[messages.length - 1];
  if (!last) return 0;
  const sinceLast = now - last.createdAt;
  if (sinceLast > TAIL_IS_LIVE_MS) return sinceLast;
  const prev = messages[messages.length - 2];
  return prev ? last.createdAt - prev.createdAt : 0;
}

/** How an affinity number should color tone and openness — injected next to the
 *  raw value so it changes behavior instead of being decoration. */
export function affinityTone(affinity: number): string {
  if (affinity <= -60) return "openly hostile";
  if (affinity <= -25) return "cold and distrustful";
  if (affinity < 25) return "neutral so far — no special warmth or grudge";
  if (affinity < 60) return "friendly and warming";
  if (affinity < 85) return "close and at ease";
  return "deeply attached";
}

/** The slice of a message the eligibility logic needs (tests build these bare). */
type MsgLite = Pick<Message, "createdAt" | "role"> & { characterId?: string | null };

export interface ReturnEligibility {
  /** characters whose off-screen note should be (re)generated for this return */
  generateFor: Character[];
  /** the character who texts first (offscreenLife "texts"), or null */
  texter: Character | null;
}

/**
 * What a return to this chat should trigger. Pure — the caller supplies the
 * clock and the stored-note lookup. Runs where real time can be fiction time
 * (see realTimeApplies: casual + setting-less immersive), and never when the
 * user plays the narrator (the opening move is theirs by spec).
 *
 * A note newer than the tail message means this return was already handled
 * (another tab, or a Stop-discarded texts-first turn) — nothing regenerates
 * and nobody texts again.
 */
export function returnEligibility(
  chat: Pick<Chat, "mode" | "playAsNarrator" | "sceneId" | "locationId">,
  characters: Character[],
  messages: MsgLite[],
  noteCreatedAt: (characterId: string) => number | null,
  now: number
): ReturnEligibility {
  const none: ReturnEligibility = { generateFor: [], texter: null };
  if (!realTimeApplies(chat) || chat.playAsNarrator) return none;
  const live = messages.filter((m) => m.role !== "marker");
  const last = live[live.length - 1];
  if (!last || now - last.createdAt < OFFSCREEN_GAP_MS) return none;
  const eligible = characters.filter((c) => alivenessOf(c).offscreenLife !== "off");
  const generateFor = eligible.filter((c) => (noteCreatedAt(c.id) ?? -1) <= last.createdAt);
  // all notes already newer than the tail → this return was handled; stay silent
  if (!generateFor.length) return none;
  const texters = eligible.filter((c) => alivenessOf(c).offscreenLife === "texts");
  return { generateFor, texter: pickTexter(texters, live) };
}

/** Among several texts-first characters, the one mid-conversation wins: whoever
 *  spoke most recently, falling back to chat order. Deterministic by design —
 *  chat-open shouldn't wait on a model call to decide who says hello. */
function pickTexter(texters: Character[], messages: MsgLite[]): Character | null {
  if (texters.length <= 1) return texters[0] ?? null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "character" || !m.characterId) continue;
    const hit = texters.find((c) => c.id === m.characterId);
    if (hit) return hit;
  }
  return texters[0];
}
