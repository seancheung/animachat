/* Stage state, derived from the message timeline — pure and client-safe.
 * The server (prompts.ts) injects store-backed library fallbacks for casual/immersive
 * chats; the client calls without them — the stage only ever *changes* in story mode,
 * where everything resolves through the chat's frozen snapshot. */

import type { Chat, Location, Message, Scene, StageStyle } from "@/lib/types";

export interface StageState {
  sceneId: string | null;
  locationId: string | null;
  /** story mode: character ids on stage (never includes the played character); null = everyone (casual/immersive) */
  present: string[] | null;
  /** story mode: ids of story secrets established as revealed truth (<reveal>) */
  revealed: string[];
  /** story mode: the playthrough has concluded (<the-end/>) */
  ended: boolean;
}

/** Library lookups for non-snapshot chats (immersive scene/location refs). */
export interface LibraryResolvers {
  scene?: (id: string) => Scene | null;
  location?: (id: string) => Location | null;
}

/** Playthroughs resolve scenes/locations from their frozen snapshot, never the library. */
export function chatScene(chat: Chat, id: string | null | undefined, lib?: LibraryResolvers): Scene | null {
  if (!id) return null;
  return chat.storySnapshot?.scenes.find((s) => s.id === id) ?? lib?.scene?.(id) ?? null;
}

export function chatLocation(chat: Chat, id: string | null | undefined, lib?: LibraryResolvers): Location | null {
  if (!id) return null;
  return chat.storySnapshot?.locations.find((l) => l.id === id) ?? lib?.location?.(id) ?? null;
}

/** Walk the timeline accumulating stage events; never a free-floating field.
 *  Only positions and events are read, so the sparse StageEventEntry projection
 *  (event-bearing messages, bodyless) folds identically to the full timeline. */
export function computeStage(
  chat: Chat,
  messages: ReadonlyArray<Pick<Message, "position" | "sceneEvent">>,
  uptoPosition?: number,
  lib?: LibraryResolvers
): StageState {
  const snap = chat.mode === "story" ? chat.storySnapshot : null;
  const participants = new Set(chat.characterIds);
  // a scene opens with its snapshot cast (minus the played character = the participants filter)
  const castOf = (sceneId: string | null): string[] | null => {
    if (!snap) return null;
    const entry = snap.scenes.find((s) => s.id === sceneId);
    return (entry?.cast ?? []).filter((id) => participants.has(id));
  };
  const startSceneId = chat.sceneId ?? snap?.scenes[0]?.id ?? null;
  const state: StageState = {
    sceneId: startSceneId,
    locationId: chat.locationId ?? chatScene(chat, startSceneId, lib)?.locationId ?? null,
    present: castOf(startSceneId),
    revealed: [],
    ended: false,
  };
  for (const m of messages) {
    if (uptoPosition !== undefined && m.position > uptoPosition) break;
    const ev = m.sceneEvent;
    if (!ev) continue;
    if (ev.sceneId) {
      // fail-soft like tag payloads: an id the snapshot doesn't know (e.g. a
      // hand-edited stage event) keeps the current scene instead of emptying the stage
      const known = !snap || snap.scenes.some((s) => s.id === ev.sceneId);
      if (known) {
        state.sceneId = ev.sceneId;
        state.locationId = chatScene(chat, ev.sceneId, lib)?.locationId ?? null;
        state.present = castOf(ev.sceneId);
      }
    }
    if (state.present && (ev.enter?.length || ev.leave?.length)) {
      const cur = new Set(state.present);
      for (const id of ev.enter ?? []) if (participants.has(id)) cur.add(id);
      for (const id of ev.leave ?? []) cur.delete(id);
      state.present = [...cur];
    }
    for (const id of ev.reveal ?? []) if (!state.revealed.includes(id)) state.revealed.push(id);
    if (ev.theEnd) state.ended = true;
  }
  return state;
}

/* ---------------- played-character immersion (story mode) ----------------
 * A playthrough is the played character's story: it opens at their entrance and
 * advances only through scenes that include them — everything else is offstage. */

export interface SceneCastRef {
  id: string;
  cast: string[];
  /** authored branching (story→scene relation); absent/empty = next scene in order */
  successors?: { sceneId: string; hint: string }[];
}

/** Where play opens for a played cast member: the chosen scene if they are in its
 *  cast, else their first authored scene — never earlier ground. Null when no scene
 *  includes them (caller keeps the default start, fail-soft). */
export function entranceSceneId(
  entries: SceneCastRef[],
  playedId: string,
  chosenId?: string | null
): string | null {
  const chosen = chosenId ? entries.find((e) => e.id === chosenId) : null;
  if (chosen?.cast.includes(playedId)) return chosen.id;
  return entries.find((e) => e.cast.includes(playedId))?.id ?? null;
}

/** The roads open from `currentId` — empty = the current scene is this playthrough's
 *  final one. A scene with declared successors offers exactly those (dropping, for a
 *  played cast member, roads whose cast excludes them — ways their story doesn't take).
 *  A scene without falls through to the next in order, skipping scenes that are some
 *  scene's declared successor: a road is entered by its branch, never by falling
 *  through the list (which is what lets two ending scenes sit side by side). With no
 *  branching anywhere this is exactly the plain in-order walk. */
export function allowedNextScenes(
  entries: SceneCastRef[],
  currentId: string | null,
  playedId?: string | null
): string[] {
  const cur = entries.find((e) => e.id === currentId);
  if (!cur) return [];
  if (cur.successors?.length) {
    const out: string[] = [];
    for (const s of cur.successors) {
      const target = entries.find((e) => e.id === s.sceneId);
      if (!target || target.id === cur.id || out.includes(target.id)) continue;
      if (playedId && !target.cast.includes(playedId)) continue;
      out.push(target.id);
    }
    return out;
  }
  const branchTargets = new Set(entries.flatMap((e) => (e.successors ?? []).map((s) => s.sceneId)));
  const idx = entries.findIndex((e) => e.id === currentId);
  for (let i = idx + 1; i < entries.length; i++) {
    if (branchTargets.has(entries[i].id)) continue;
    if (playedId && !entries[i].cast.includes(playedId)) continue;
    return [entries[i].id];
  }
  return [];
}

export interface StageAssets {
  scene: Scene | null;
  location: Location | null;
  artworkAsset: string | null;
  bgmAsset: string | null;
  ambientAsset: string | null;
  stageStyle: StageStyle | null;
}

/** Location assets win when present; otherwise the scene's own. Style fields resolve the same way. */
export function resolveStageAssets(chat: Chat, state: StageState, lib?: LibraryResolvers): StageAssets {
  const scene = chatScene(chat, state.sceneId, lib);
  const location = chatLocation(chat, state.locationId, lib);
  // per-field precedence: the location's set fields win, the scene's fill the rest;
  // styles are opt-in — only an explicitly enabled one contributes
  const active = (st: StageStyle | null | undefined) => (st?.enabled === true ? st : null);
  const style: StageStyle = {
    ...(active(scene?.stageStyle) ?? {}),
    ...Object.fromEntries(Object.entries(active(location?.stageStyle) ?? {}).filter(([, v]) => v != null)),
  };
  delete style.enabled;
  return {
    scene,
    location,
    artworkAsset: location?.artworkAsset ?? scene?.artworkAsset ?? null,
    bgmAsset: location?.bgmAsset ?? scene?.bgmAsset ?? null,
    ambientAsset: location?.ambientAsset ?? scene?.ambientAsset ?? null,
    stageStyle: Object.values(style).some((v) => v != null) ? style : null,
  };
}
