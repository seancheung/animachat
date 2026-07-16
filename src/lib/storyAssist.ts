/* Merges a story co-writer <fields> payload into the story document draft.
 * The co-writer authors the WHOLE document: embedded characters/locations/
 * scenes/lorebooks and secrets are identified by name (secrets by title) within
 * the story — a new name creates an item, an existing one updates it, and
 * "renameFrom" renames. All name links (a scene's locationName/castNames/
 * successors, a secret's knownByNames) resolve against the document itself,
 * never the library. Unresolved names drop fail-soft, like tag payloads. */

import { v4 as uuidv4 } from "uuid";
import type { StoryDocument } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const norm = (n: unknown) => String(n ?? "").trim().toLowerCase();

/** Merge incoming items into `cur` by name: update in place, append new (with a
 *  fresh id), honor renameFrom. Returns a new array; `cur` is untouched. */
function mergeByName(cur: any[], incoming: unknown): any[] {
  if (!Array.isArray(incoming)) return cur;
  const next = [...cur];
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, any>;
    if (!norm(item.name)) continue;
    // a rename targets the item under its old name (falling back to the new one,
    // in case the model repeats a rename that already happened)
    const renameFrom = norm(item.renameFrom);
    let idx = renameFrom ? next.findIndex((x) => norm(x.name) === renameFrom) : -1;
    if (idx === -1) idx = next.findIndex((x) => norm(x.name) === norm(item.name));
    const fields = { ...item };
    delete fields.renameFrom;
    if (idx === -1) next.push({ id: uuidv4(), ...fields });
    else next[idx] = { ...next[idx], ...fields, id: next[idx].id };
  }
  return next;
}

/** Reorder `list` to follow `names` (by item name); unnamed leftovers keep their
 *  relative order at the end. A missing/empty order leaves the list alone. */
function applyOrder(list: any[], names: unknown): any[] {
  if (!Array.isArray(names) || !names.length) return list;
  const byName = new Map(list.map((x) => [norm(x.name), x]));
  const ordered: any[] = [];
  for (const n of names) {
    const item = byName.get(norm(n));
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  return [...ordered, ...list.filter((x) => !ordered.includes(x))];
}

/**
 * Apply a co-writer payload to the story document draft. Pure — returns the next
 * draft. The server's saveStory normalization remains the safety net; this keeps
 * the draft coherent enough to edit (ids minted, name links resolved).
 */
export function mergeStoryAssist(doc: StoryDocument, partial: any): StoryDocument {
  if (!partial || typeof partial !== "object") return doc;
  const out: any = { ...doc };
  for (const k of ["name", "description", "destination"] as const) {
    if (typeof partial[k] === "string") out[k] = partial[k];
  }

  out.characters = applyOrder(mergeByName(doc.characters, partial.characters), partial.castOrder);
  out.locations = mergeByName(doc.locations, partial.locations);
  out.lorebooks = mergeByName(doc.lorebooks, partial.lorebooks).map((lb: any) => ({
    ...lb,
    // lorebook entries carry their own ids ("keep existing id or omit for new")
    entries: Array.isArray(lb.entries)
      ? lb.entries.map((e: any) => ({ ...e, id: typeof e?.id === "string" && e.id ? e.id : uuidv4() }))
      : [],
  }));

  const charIdByName = new Map(out.characters.map((c: any) => [norm(c.name), c.id as string]));
  const locIdByName = new Map(out.locations.map((l: any) => [norm(l.name), l.id as string]));

  // scenes: merge the sheet+contract fields by name, then resolve the name links —
  // successors last, against the fully merged scene list
  let scenes = mergeByName(doc.scenes, partial.scenes);
  const incomingByName = new Map<string, any>(
    (Array.isArray(partial.scenes) ? partial.scenes : [])
      .filter((e: any) => e && typeof e === "object" && norm(e.name))
      .map((e: any) => [norm(e.name), e] as [string, any])
  );
  scenes = scenes.map((e: any) => {
    const raw = incomingByName.get(norm(e.name));
    const next = { ...e };
    if (raw) {
      if ("locationName" in raw)
        next.locationId = locIdByName.get(norm(raw.locationName)) ?? null;
      if (Array.isArray(raw.castNames))
        next.cast = raw.castNames.map((n: unknown) => charIdByName.get(norm(n))).filter(Boolean);
    }
    // strip the name-link carriers; the resolved ids are the real fields
    delete next.locationName;
    delete next.castNames;
    next.cast = Array.isArray(next.cast) ? next.cast : [];
    return next;
  });
  const sceneIdByName = new Map(scenes.map((s: any) => [norm(s.name), s.id as string]));
  scenes = scenes.map((e: any) => {
    const raw = incomingByName.get(norm(e.name));
    const next = { ...e };
    if (raw && Array.isArray(raw.successors)) {
      next.successors = raw.successors
        .map((s: any) => ({
          sceneId: sceneIdByName.get(norm(s?.sceneName)) ?? (typeof s?.sceneId === "string" ? s.sceneId : ""),
          hint: typeof s?.hint === "string" ? s.hint : "",
        }))
        .filter((s: any) => s.sceneId && s.sceneId !== e.id);
    } else {
      next.successors = (Array.isArray(next.successors) ? next.successors : []).filter(
        (s: any) => s?.sceneId && s.sceneId !== e.id
      );
    }
    return next;
  });
  out.scenes = applyOrder(scenes, partial.sceneOrder);

  // secrets: identified by title
  if (Array.isArray(partial.secrets)) {
    const next = [...doc.secrets];
    for (const raw of partial.secrets) {
      if (!raw || typeof raw !== "object" || !norm(raw.title)) continue;
      const renameFrom = norm(raw.renameFrom);
      let idx = renameFrom ? next.findIndex((x) => norm(x.title) === renameFrom) : -1;
      if (idx === -1) idx = next.findIndex((x) => norm(x.title) === norm(raw.title));
      const knownBy = Array.isArray(raw.knownByNames)
        ? (raw.knownByNames.map((n: unknown) => charIdByName.get(norm(n))).filter(Boolean) as string[])
        : undefined;
      const fields = {
        title: String(raw.title),
        content: typeof raw.content === "string" ? raw.content : (next[idx]?.content ?? ""),
        revealHint: typeof raw.revealHint === "string" ? raw.revealHint : (next[idx]?.revealHint ?? ""),
      };
      if (idx === -1) next.push({ id: uuidv4(), knownBy: knownBy ?? [], ...fields });
      else next[idx] = { ...next[idx], ...fields, ...(knownBy ? { knownBy } : {}) };
    }
    out.secrets = next;
  }

  return out as StoryDocument;
}
