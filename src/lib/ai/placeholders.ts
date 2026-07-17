/**
 * Placeholder tags usable in character/persona/location/scene/story/lorebook sheets.
 * Replaced with actual chat values at injection time (prompt assembly, greeting insertion):
 *
 *   [char_name]              in a character's own sheet (description, greeting, example
 *                            dialogue, custom expressions): that character's name;
 *                            elsewhere: the chat's first character
 *   [charN_name]             Nth character's name (1-based, chat order)
 *   [user_name] / [persona_name]  the active persona's name
 *   [loc_name]               active location name
 *   [scene_name]             active scene name
 *   [story_name]             the chat's story name
 *
 * Unresolvable tags get a neutral fallback so the AI never sees broken brackets.
 */

export interface PlaceholderValues {
  characterNames: string[];
  /** binds [char_name] to the character whose sheet is being substituted */
  selfName?: string | null;
  userName?: string | null;
  locationName?: string | null;
  sceneName?: string | null;
  storyName?: string | null;
}

const FALLBACKS = {
  char: "another character",
  user: "the user",
  loc: "the current place",
  scene: "the current scene",
  story: "the story",
};

/** Apply fn to every string, recursively across arrays/objects. */
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/**
 * Rewrite a bracketed literal self-name ("[Tom]" in Tom's own sheet) to the [char_name] tag,
 * recursively across string fields. AI co-writers sometimes fill the character's name into
 * the tag brackets instead of writing the tag verbatim.
 */
export function normalizeSelfTags<T>(value: T, selfName: string | null | undefined): T {
  const name = selfName?.trim();
  if (!name) return value;
  const re = new RegExp(`\\[\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]`, "gi");
  return mapStrings(value, (s) => s.replace(re, "[char_name]"));
}

/**
 * Boundary cleanup for co-writer field data (mechanical enforcement, like
 * normalizeSelfTags — prompts alone don't hold): models writing prose into JSON
 * strings sometimes double-escape newlines, so a literal backslash-n survives the
 * parse; and they write placeholder tags with stray spaces inside the brackets
 * ("[ user_name ]"), which no substitution matches. Both are undone here,
 * recursively across string fields. Only the known tag names are touched, so
 * ordinary bracketed prose stays as written.
 */
export function normalizeAssistStrings<T>(value: T): T {
  return mapStrings(value, (s) =>
    s
      .replace(/\\r\\n|\\n/g, "\n")
      .replace(
        /\[\s*(char\d*_name|user_name|persona_name|loc_name|scene_name|story_name)\s*\]/gi,
        (_m, tag: string) => `[${tag}]`
      )
  );
}

export function substitutePlaceholders(text: string, v: PlaceholderValues): string {
  if (!text || !text.includes("[")) return text;
  return text.replace(
    // \s* inside the brackets: runtime backstop for spaced tags ("[ user_name ]")
    // in hand-typed or already-saved sheets the assist boundary never cleaned
    /\[\s*(char(\d*)_name|user_name|persona_name|loc_name|scene_name|story_name)\s*\]/gi,
    (_m, tag: string, n?: string) => {
      const t = tag.toLowerCase();
      if (t.startsWith("char")) {
        if (!n && v.selfName) return v.selfName;
        const idx = n ? Number(n) - 1 : 0;
        return v.characterNames[idx] ?? FALLBACKS.char;
      }
      if (t === "user_name" || t === "persona_name") return v.userName || FALLBACKS.user;
      if (t === "loc_name") return v.locationName || FALLBACKS.loc;
      if (t === "scene_name") return v.sceneName || FALLBACKS.scene;
      return v.storyName || FALLBACKS.story;
    }
  );
}
