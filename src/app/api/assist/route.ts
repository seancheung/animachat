import { bad, handler } from "@/lib/api";
import { AiConfigError, resolveModel, streamLlm } from "@/lib/ai/client";
import { describePartialProgress, dropOpenArrayElement, parsePartialJson } from "@/lib/ai/partialJson";
import { normalizeAssistStrings, normalizeSelfTags } from "@/lib/ai/placeholders";
import {
  getCharacter,
  getLocation,
  getLorebook,
  getPersona,
  getScene,
  getSettings,
  getStory,
} from "@/lib/store";
import { attachmentAllowances, taskMaxTokens } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_STYLE_DOC =
  `"stageStyle": {"enabled": true, "stageBg": "#hex", "panelBg": "#hex", "panelFg": "#hex", "messageBg": "#hex", "messageFg": "#hex", "accent": "#hex", "accentFg": "#hex"} or null ` +
  `(optional chat-UI palette while this place is active — colors only, opacity is a user setting — organized as Bg/Fg SURFACE PAIRS — each Fg is the text ON its own Bg and must contrast with that Bg, never judge it against another surface: ` +
  `panelBg+panelFg = the floating chat panel and its controls (inputs, buttons, badges, borders all derive from this pair); ` +
  `messageBg+messageFg = the message bubbles; accent+accentFg = primary buttons & highlights; ` +
  `stageBg = the VN stage backdrop behind the sprites, no text ever sits on it. ` +
  `Every field optional — an omitted Fg auto-contrasts with its Bg. Match the place's mood; ` +
  `styles are OFF unless "enabled": true — include "enabled": true when the user wants the style applied)`;

const FIELD_DOCS: Record<string, string> = {
  character:
    `"name": string; "description": string (the PUBLIC sheet, written in THIRD person — personality as it shows, background as known, mannerisms; every other participant in a chat sees it in full. Spoiler-free standing color in the PRESENT state: who they ARE as things stand, never plot events, twists, or anything yet to happen — a future thing belongs on a sheet only as the present intention or arrangement already in place ("is saving coin to flee the city", never "will flee the city")); ` +
    `"innerSelf": string (the PRIVATE side of the sheet, seen ONLY by this character's own prompt, never by other characters or the narrator — drives, wounds, self-knowledge, standing behavioral rules, things never told anyone — their CURRENT state, never foreknowledge of what is to come; put observable material in the description instead, and never duplicate between the two. Written in THIRD person like the description — authorial direction about the character, never "I …" inner monologue or "you …". Not a plot secret: a hidden truth with a reveal moment belongs in a story's secrets, not here); ` +
    `"greeting": string (their opening message, *actions* in asterisks, "dialogue" in quotes — ONLY the character's own words, actions and perceptions: never the user's words, actions or reactions, and it ends where the user can respond); ` +
    `"exampleDialogue": string (a few short sample lines showing their voice — ONLY the character's own utterances, one per line, *actions* in asterisks, "dialogue" in quotes; NEVER a labeled multi-speaker transcript — no "Name: ..." turn labels, no other speakers' lines. Timeless and spoiler-free: voice only, never plot events or reveals); ` +
    `"imagePrompt": string (text-to-image prompt for their neutral sprite — see IMAGE PROMPT RULES; cover, in order: physical appearance (body, face, hair), outfit, a neutral standing pose, the framing/view distance (e.g. "full-body shot"), and end with a solid flat single-color background); ` +
    `"customExpressions": [{"name": "kebab-case", "description": "when to use it"}]`,
  persona:
    `"name": string; "description": string (who the user is in the roleplay — a THIRD-person character sheet ("[user_name] is …", or their name), ` +
    `NEVER second person: the text is injected into the AI characters' prompts as background about their interlocutor, where "you are …" would read as describing THEM)`,
  location:
    `"name": string; "description": string (the place, its atmosphere, sensory details); ` +
    `"imagePrompt": string (text-to-image prompt for the background artwork of this place — see IMAGE PROMPT RULES); ` +
    STAGE_STYLE_DOC,
  scene:
    `"name": string; "setup": string (the situation: what is happening, stakes, how it starts. AUDIENCE-VISIBLE — every participant's prompt receives it while the scene plays: present-state and spoiler-free, what anyone in the scene could know; in a story, the scene's private job goes in its contract fields and hidden truths in secrets); ` +
    `"imagePrompt": string (text-to-image prompt for the background artwork of this scene — see IMAGE PROMPT RULES); ` +
    STAGE_STYLE_DOC,
  lorebook:
    `"name": string; "description": string; ` +
    `"entries": [{"id": "keep existing id or omit for new", "title": string, "keywords": ["trigger", "words"], "content": string (PUBLIC background knowledge — injected into every participant's prompt when a keyword comes up: world facts as they stand, spoiler-free; a guarded truth with a reveal moment belongs in a story's secrets, never in a lorebook), "scanDepth": 8}]`,
};

// whole-document story authoring: a story OWNS its characters/locations/scenes/
// lorebooks as embedded items — the co-writer edits the entire document in one
// conversation, linking everything by name WITHIN the story (never the library)
FIELD_DOCS.story =
  `"name": string; "description": string (the PREMISE — the situation as play opens, spoiler-free: injected into EVERY participant's prompt, characters included; put hidden truths in secrets, not here); ` +
  `"destination": string (one line naming where the story is headed and what "the end" means — seen only by the narrator; steers the ending without scripting the route).\n` +
  `This story OWNS its characters, locations, scenes and lorebooks as EMBEDDED items — they exist only inside this story. Each embedded item is identified BY NAME within the story: a new name creates it, an existing name updates it (only the fields you include change); add "renameFrom": "its current name" alongside a new "name" to rename (and re-emit fields of other items that referred to the old name). Give new items complete fields; never re-emit unchanged items.\n` +
  `"characters": [{${FIELD_DOCS.character}}] (the embedded cast — new ones append to the roster in the order given)\n` +
  `"castOrder": ["every", "cast", "name", "in", "roster", "order"] (optional — reorders the whole cast; order drives [charN_name] and the play-as picker)\n` +
  `"locations": [{${FIELD_DOCS.location}}] (embedded places — scenes link to them by name)\n` +
  `"scenes": [{${FIELD_DOCS.scene}; "locationName": string (one of THIS STORY's locations, linked by name; its artwork/BGM fill in whatever the scene doesn't set), "castNames": ["everyone", "appearing", "in", "the scene"] (at its opening OR later — the narrator stages each entrance during play, so list the scene's whole cast, not just who is in sight at the first line), "goal": "what the scene is FOR dramatically", "obstacles": "what resists", "exit": "what done looks like — the cue to advance", "pressures": "what moves ELSEWHERE while this scene plays — offstage momentum surfacing only as consequences", "successors": [{"sceneName": "an allowed next scene of this story", "hint": "condition guidance — when this road is the one (never a mechanical gate)"}]}] (the embedded ordered scene sequence, each with its contract; goal/obstacles/exit/pressures are optional but give the scene a job; successors are optional AUTHORED BRANCHING — omit to fall through to the next scene in order; list 2+ roads to make a branch point. A scene named as some scene's successor is reached ONLY by its road, never by fallthrough — so a branch target with no successors of its own is an ending: several such final scenes = several endings)\n` +
  `"sceneOrder": ["every", "scene", "name", "in", "play", "order"] (optional — reorders the whole sequence)\n` +
  `"secrets": [{"title": "short handle", "content": "the hidden truth — PRESENT TENSE, already true as play opens", "knownByNames": ["cast", "names", "who", "ALREADY", "know", "at", "open"], "revealHint": "when/how it wants to surface"}] (identified by title, "renameFrom" renames; knownByNames name embedded cast members and may be empty for a truth nobody on stage knows — it lists who already knows as play OPENS, never who the secret concerns: a character meant to learn it mid-story is left out)\n` +
  `"lorebooks": [{${FIELD_DOCS.lorebook}}] (embedded — attached to every playthrough of the story)`;

// multi-item "library assistant" mode: one batch of items across the library types
// (stories are authored on the story page, not here)
FIELD_DOCS.library =
  `"items": [{"type": "character" | "persona" | "location" | "scene" | "lorebook", ...fields for that type}]\n` +
  `Per-type fields:\n` +
  `- character: ${FIELD_DOCS.character}\n` +
  `- persona: ${FIELD_DOCS.persona}\n` +
  `- location: ${FIELD_DOCS.location}\n` +
  `- scene: ${FIELD_DOCS.scene}; "locationName": string (optional — the name of a location among these items or in the library, linked on save)\n` +
  `- lorebook: ${FIELD_DOCS.lorebook}`;

interface AssistBody {
  entityType: keyof typeof FIELD_DOCS;
  fields: Record<string, unknown>;
  /** applied: this assistant reply wrote a fields block into the form — the client
   *  stores replies with the block stripped, so the flag is what's left of it */
  messages: { role: "user" | "assistant"; content: string; applied?: boolean }[];
  /** library items attached by the user as background context */
  references?: { type: string; id: string }[];
  /** text files attached by the user as source material */
  attachments?: { name: string; text: string }[];
}

/** Serialize an attached library item for the system prompt; null if it no longer exists. */
async function referenceText(ref: { type: string; id: string }): Promise<string | null> {
  switch (ref.type) {
    case "character": {
      const c = await getCharacter(ref.id);
      if (!c) return null;
      // authoring-time context — the user is the author, so the private side rides along, labeled
      return `CHARACTER "${c.name}"\n${c.description}${c.innerSelf ? `\nInner self (private to the character): ${c.innerSelf}` : ""}${c.exampleDialogue ? `\nExample dialogue:\n${c.exampleDialogue}` : ""}`;
    }
    case "persona": {
      const p = await getPersona(ref.id);
      return p && `PERSONA "${p.name}" (an identity the user plays)\n${p.description}`;
    }
    case "location": {
      const l = await getLocation(ref.id);
      return l && `LOCATION "${l.name}"\n${l.description}`;
    }
    case "scene": {
      const s = await getScene(ref.id);
      if (!s) return null;
      const loc = s.locationId ? await getLocation(s.locationId) : null;
      return `SCENE "${s.name}"${loc ? ` (at location "${loc.name}")` : ""}\n${s.setup}`;
    }
    case "story": {
      const st = await getStory(ref.id);
      if (!st) return null;
      // embedded document: every name resolves within the story itself
      const nameOf = (cid: string) => st.characters.find((c) => c.id === cid)?.name;
      const cast = st.characters.map((c) => c.name);
      const scenes = st.scenes.map((e) => {
        const who = e.cast.map(nameOf).filter(Boolean);
        return `${e.name}${who.length ? ` (on stage: ${who.join(", ")})` : ""}`;
      });
      return (
        `STORY "${st.name}"\n${st.description}` +
        (st.destination ? `\nDestination: ${st.destination}` : "") +
        (cast.length ? `\nCast in order: ${cast.join(", ")}` : "") +
        (scenes.length ? `\nScenes in order: ${scenes.join(" → ")}` : "") +
        (st.secrets.length
          ? `\nSecrets:\n${st.secrets
              .map((s) => {
                const who = s.knownBy.map(nameOf).filter(Boolean);
                return `- "${s.title}": ${s.content} (held by: ${who.join(", ") || "nobody"})`;
              })
              .join("\n")}`
          : "")
      );
    }
    case "lorebook": {
      const lb = await getLorebook(ref.id);
      if (!lb) return null;
      return `LOREBOOK "${lb.name}"${lb.description ? ` — ${lb.description}` : ""}\n${lb.entries
        .map((e) => `- ${e.title}: ${e.content}`)
        .join("\n")}`;
    }
  }
  return null;
}

const OPEN = "<fields>";
const CLOSE = "</fields>";

/** Stands in for an applied fields block in the history sent to the model. The client
 *  keeps replies with the block stripped, which used to teach the model by example
 *  that prose alone updates the form — it would eventually claim updates without
 *  emitting any block. The marker keeps the convention visible: replies that changed
 *  the form ended with a block. */
const ELIDED_BLOCK = `${OPEN}(elided — this block was applied; the CURRENT FORM STATE reflects it)${CLOSE}`;

export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as AssistBody;
  if (!FIELD_DOCS[body.entityType]) return bad("unknown entityType");
  if (!body.messages?.length) return bad("messages required");

  let modelRef;
  try {
    modelRef = await resolveModel("assist");
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 500);
  }
  const settings = await getSettings();
  const isLibrary = body.entityType === "library";
  // whole-batch modes (the Assistant, whole-document stories) need room for many items
  const bigBatch = isLibrary || body.entityType === "story";
  const refTexts = (await Promise.all((body.references ?? []).map(referenceText))).filter(
    Boolean
  ) as string[];
  const attachments = (body.attachments ?? [])
    .filter((a) => a?.text)
    .map((a) => ({ name: a.name, text: String(a.text) }));
  const allowances = attachmentAllowances(attachments);
  const attachTexts = attachments.map((a, i) => {
    const cut = a.text.length > allowances[i];
    return `FILE "${a.name}"\n${a.text.slice(0, allowances[i])}${cut ? "\n…(truncated)" : ""}`;
  });

  const system =
    `You are a creative co-writing assistant inside the editor of a visual-novel roleplay app. ` +
    (isLibrary
      ? `You are helping the user populate their library: create one or more items — characters, personas, locations, scenes, lorebooks — in one session, often extracted from attached source material or built as a themed set. ` +
        `You cannot create stories, and don't build a requested story's parts as library items either: decline and point the user to the Stories page, whose editor has its own co-writer that authors the whole story — cast, scenes, secrets — as one self-contained document. `
      : body.entityType === "story"
        ? `You are helping the user author a story — a self-contained work that owns its characters, locations, scenes and lorebooks as embedded items, all edited through this one conversation (often extracted from attached source material). `
        : `You are helping the user create/refine a ${body.entityType} — exactly the ONE whose CURRENT FORM STATE is below; every field you set lands on it. ` +
          `Filling in the open form is your job (an empty state is simply a brand-new ${body.entityType} being created); what you cannot do is produce a SEPARATE item beyond it, of this or any other type — asked for one, don't write it over the open form: decline and point the user to the right place — the library page's New button for another fresh item, its Assistant for a whole batch, the Stories page for stories. `) +
    `Discuss ideas conversationally in ${settings.language}, ask at most one question at a time, and be concrete.\n\n` +
    `CURRENT FORM STATE:\n${JSON.stringify(body.fields, null, 2)}\n\n` +
    (refTexts.length
      ? `REFERENCE MATERIAL — library items the user attached for context. Use them to make the new content fit that cast and world (read-only background — don't copy them into the fields verbatim unless asked):\n\n${refTexts.join("\n\n")}\n\n`
      : "") +
    (attachTexts.length
      ? `SOURCE MATERIAL — text files the user attached (novels, notes, transcripts). Draw items from them when asked — stay faithful to the source:\n\n${attachTexts.join("\n\n")}\n\n`
      : "") +
    `FIELDS YOU MAY SET:\n${FIELD_DOCS[body.entityType]}\n\n` +
    (body.entityType === "story"
      ? `NO PLACEHOLDER TAGS IN STORY CONTENT: everything in a story is FIXED — its cast, places, scenes and name are its own embedded items, nothing is dynamic. ` +
        `Write LITERAL NAMES everywhere: never [user_name]/[persona_name] (there is no predetermined user — at playthrough time the player takes the seat of any cast member, or of a persona, or just watches), ` +
        `never positional tags like [char2_name] (positions shift with whoever is played), and never [char_name]/[loc_name]/[scene_name]/[story_name] either — say "Mira", "the Moonlit Tavern", not a tag. ` +
        `Relationships are authored between named cast members and hold regardless of who plays.\n\n`
      : `Text fields support placeholder tags replaced with live chat values: [user_name] (the user's persona), ` +
        `[loc_name], [scene_name], [story_name], and — inside a character's own fields — [char_name] for the character themselves. ` +
        `Prefer tags over hardcoded names where they fit, so content stays reusable across chats; referring to OTHER specific characters by their literal name is fine. ` +
        `Tags are literal strings the app substitutes at chat time — write them verbatim, brackets and all (exactly "[char_name]", NEVER the actual name inside brackets like "[Tom]").\n\n`) +
    (body.entityType === "story"
      ? `STORY DESIGN PRINCIPLE — author situations, not plots. A story records what is TRUE and under what PRESSURE, never a sequence of events: the player's freedom breaks sequences, it cannot break truths.\n` +
        `- The premise is the situation as play opens — a web of wants, debts and tensions, spoiler-free. Hidden truths belong in secrets, never in the premise. And it is a SITUATION, not an introduction: never a jacket blurb or teaser about where the night will go — no "what starts as X turns into Y", no arc, no hinting that secrets exist. "Mira owes the Guild more than money; the collectors arrive at dawn" is a premise; "a night that will change everything" is marketing about the future.\n` +
        `- Extracting from source material, freeze the world at the story's OPENING: the premise, character sheets and lorebooks describe that moment only — everything the source reveals later becomes secrets, contracts, pressures and the destination, never sheet or premise content.\n` +
        `- Character sheets are spoiler-free standing color, all three fields (description, innerSelf, exampleDialogue): who someone is, wants, fears, how they carry themselves — never plot events, twists, or what will happen. A concealed EVENT or truth with a reveal moment is a secret; the sheet may carry the motive that makes it true. And sheets are the character's state as play OPENS — like secrets, present tense: a future thing is authored as the intention or arrangement already in place, and growth or change belongs to play, never the sheet. Never "will eventually betray them" in an innerSelf: if it is already arranged, it is a secret in present tense; if it is a leaning, write the present drive ("resents every order he follows"), not the act it may one day cause.\n` +
        `- Secrets carry the drama: give each a holder (or none), a truth that stays true whatever the player does, and a reveal hint naming the KIND of moment that surfaces it — not a scheduled scene.\n` +
        `- Secrets are STANDING TRUTHS in present tense: a "will happen" is authored as the intention or arrangement already in place ("she has already signed the order", not "she will sign it in scene 3").\n` +
        `- knownByNames = who already knows as play OPENS, never who the secret concerns. A character meant to LEARN a truth mid-story starts outside it — extracting from a novel, mark who knows at the story's opening, not who knows by its end.\n` +
        `- Scene contracts are jobs, not scripts: a goal (what the scene is for), obstacles (what resists), an exit condition (what done looks like). Never "then X happens" — write what pulls and what blocks, and let play find the path. The setup is the audience-visible half (everyone's prompts receive it); the contract is the scene's private job, seen by the narrator and director only.\n` +
        `- Offstage pressures keep the world moving: an optional per-scene line naming what advances ELSEWHERE while the scene plays ("the rival's men search the docks tonight") — it surfaces as consequences, never as a scheduled event.\n` +
        `- Branches are situations the truths make reachable, not scripted routes: give a scene successors only where the truths genuinely open more than one road, each with a condition hint ("if trust has grown → Moonlit Confession") — guidance for the narrator's judgment, never a gate. Multiple final scenes are multiple endings; the destination says what "the end" MEANS, each final scene is one way of answering it.\n` +
        `- The destination names where the story is headed, not the route or the twists.\n` +
        `- If the user asks to script a beat ("then in scene 3 she betrays him"), don't put it in a scene or the premise — convert it into the truths and pressures that make that moment likely (a secret with a reveal hint, a motive in a character sheet, an obstacle), and say that's what you did.\n\n`
      : "") +
    (isLibrary || ["character", "location", "scene", "story"].includes(body.entityType)
      ? `IMAGE PROMPT RULES — every "imagePrompt" field is fed directly to a text-to-image generator:\n` +
        `- STRICTLY VISUAL: describe only what a camera would capture. Never include names, placeholder tags, personality, feelings, backstory, or lore — translate such traits into visible details instead (e.g. "a battle-worn veteran" → "scratched armor, a faded scar across the brow").\n` +
        `- Always write it in English, whatever the conversation language, unless the user explicitly asks for the prompt in another language.\n` +
        `- Never mention aspect ratio or image dimensions.\n` +
        `- Character sprites only: no environment or scenery — cover appearance, outfit, pose and framing, then end with a solid flat single-color background (pick a color that complements the design).\n\n`
      : "") +
    `Whenever you and the user have converged on content (or the user asks you to write it), apply it: end your reply with\n` +
    (isLibrary
      ? `${OPEN}{ "items": [ ...only items you are adding or changing... ] }${CLOSE}\n` +
        `An item is identified by its "type" + "name": a new name creates an item, an existing name updates it (only the fields you include change). ` +
        `To RENAME an item, add "renameFrom": "its current name" alongside the new "name" — a bare new name would create a duplicate. ` +
        `When a rename changes a name other items refer to (a story's castNames/scenes, a scene's locationName, lorebookNames), re-emit those fields with the new name too. ` +
        `Give new items complete fields. Never re-emit unchanged items.\n`
      : `${OPEN}{ ...only the fields you are changing... }${CLOSE}\n`) +
    `The JSON must be valid. Escape newlines in JSON strings exactly once ("\\n") — never a double-escaped "\\\\n", which would put a literal backslash-n in the text. Update fields incrementally as the conversation progresses — don't wait for everything to be decided. Keep the prose part of your reply short; the content goes in the fields.\n` +
    `A reply without a ${OPEN} block changes NOTHING: never say you updated, applied or wrote anything into the form unless THIS reply ends with the block. ` +
    `In the conversation history your earlier blocks appear elided as "${ELIDED_BLOCK}" — that marker only records that a block was applied there; never write the marker yourself, always emit full valid JSON.`;

  // restore the block convention in the history the model sees (the client strips
  // applied blocks from stored replies); also maps to clean {role, content} — the
  // client's bookkeeping props must not leak into provider payloads
  const llmMessages = body.messages.map((m) => ({
    role: m.role,
    content: m.role === "assistant" && m.applied ? `${m.content}\n\n${ELIDED_BLOCK}` : m.content,
  }));

  // shared by the final block and the streaming partials
  const normalizeFields = (rawFields: Record<string, unknown>): Record<string, unknown> => {
    // every entity type: undo double-escaped newlines (a literal backslash-n that
    // survived JSON.parse) and de-space placeholder tags ("[ user_name ]")
    const fields = normalizeAssistStrings(rawFields);
    if (body.entityType === "character") {
      // models sometimes fill the name into the tag brackets ("[Tom]") — undo that
      const selfName =
        (typeof fields.name === "string" && fields.name) ||
        (typeof body.fields?.name === "string" && (body.fields.name as string)) ||
        null;
      return normalizeSelfTags(fields, selfName);
    }
    if (isLibrary && Array.isArray(fields.items)) {
      return {
        ...fields,
        items: fields.items.map((it: unknown) => {
          const item = it as { type?: string; name?: string };
          return item?.type === "character"
            ? normalizeSelfTags(item, typeof item.name === "string" ? item.name : null)
            : it;
        }),
      };
    }
    // story mode gets no normalizeSelfTags: story content is all-literal, and
    // the client's mergeStoryAssist literalizes any tag slips against the
    // document's own names (the tag direction would be wrong here)
    return fields;
  };

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  if (req.signal.aborted) abort.abort(); // listener-after-abort never fires

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client disconnected — the abort signal ends the work; don't crash the stream */
        }
      };
      let visible = ""; // text already sent
      let buf = ""; // full accumulated text
      let inFields = false;
      let fieldsStart = -1; // offset of the JSON payload inside buf, once OPEN is seen

      const flush = () => {
        if (inFields) return;
        const idx = buf.indexOf(OPEN);
        if (idx !== -1) {
          const emit = buf.slice(visible.length, idx);
          if (emit) send({ type: "text", text: emit });
          visible = buf.slice(0, idx);
          inFields = true;
          fieldsStart = idx + OPEN.length;
          // the fields block streams into the form as it is written (see below) —
          // tell the client the assistant is now writing into the form, not stalled
          send({ type: "drafting" });
          return;
        }
        // hold back a tail that could be a partial "<fields>"
        let safeEnd = buf.length;
        for (let k = Math.min(OPEN.length - 1, buf.length); k > 0; k--) {
          if (buf.endsWith(OPEN.slice(0, k))) {
            safeEnd = buf.length - k;
            break;
          }
        }
        if (safeEnd > visible.length) {
          send({ type: "text", text: buf.slice(visible.length, safeEnd) });
          visible = buf.slice(0, safeEnd);
        }
      };

      // Live partials: while the fields block streams, parse the growing JSON
      // prefix (throttled) and push best-effort snapshots so the form fills as
      // the model writes. Scalar fields stream as they grow; a collection
      // element still under construction is dropped (the merges key items by
      // name — a truncated name would mint a duplicate). The full block parsed
      // at the end stays authoritative and re-applies over these.
      let lastPartialAt = 0;
      let lastPartialJson = "";
      let lastPartialLabel: string | null = null;
      let partialBroken = false; // a malformed prefix stays malformed — stop parsing
      const maybeSendPartial = () => {
        if (fieldsStart === -1 || partialBroken) return;
        const now = Date.now();
        if (now - lastPartialAt < 150) return;
        lastPartialAt = now;
        const parsed = parsePartialJson(buf.slice(fieldsStart));
        if (!parsed) {
          partialBroken = true; // the strict parse + fixups at the end take it from here
          return;
        }
        const value = dropOpenArrayElement(parsed);
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        const label = describePartialProgress(parsed);
        const fields = normalizeFields(value as Record<string, unknown>);
        const json = JSON.stringify(fields);
        if (json !== lastPartialJson) {
          lastPartialJson = json;
          send({ type: "fields-partial", fields, label });
        } else if (label !== lastPartialLabel) {
          send({ type: "drafting", label });
        }
        lastPartialLabel = label;
      };

      let truncated = false;
      try {
        for await (const ev of streamLlm({
          modelRef,
          system,
          messages: llmMessages,
          // item batches (e.g. novel extraction) need room; the single-entity
          // panel keeps a small fixed cap — one form never needs more
          maxTokens: bigBatch ? taskMaxTokens(settings, "assist") : 2000,
          feature: "assist",
          signal: abort.signal,
        })) {
          if (ev.type === "text") {
            buf += ev.text;
            flush();
            if (inFields) maybeSendPartial();
          } else if (ev.type === "stop") {
            truncated = ev.truncated;
          }
        }
        if (!inFields && visible.length < buf.length) {
          send({ type: "text", text: buf.slice(visible.length) });
        }
        const fieldsRe = new RegExp(`${OPEN}([\\s\\S]*?)(?:${CLOSE}|$)`);
        const m = buf.match(fieldsRe);
        if (m) {
          // On a parse failure, feed the error back to the model for a fixup, up to the
          // configured retry count — pointless after a maxTokens cutoff, where the cure
          // is a shorter batch, not better syntax.
          const fixupRetries = truncated ? 0 : Math.max(0, settings.assistFixupRetries);
          let raw = m[1].trim();
          let lastReply = buf;
          let fields;
          let parsed = false;
          let parseErr: unknown = null;
          for (let attempt = 0; ; attempt++) {
            try {
              fields = JSON.parse(raw);
              parsed = true;
              break;
            } catch (e) {
              parseErr = e;
              if (attempt >= fixupRetries || abort.signal.aborted) break;
              console.error(`assist: fields block failed to parse, requesting fixup ${attempt + 1}/${fixupRetries}:`, e);
              // the panel keeps showing its "drafting" indicator while this runs
              let fixed = "";
              try {
                for await (const ev of streamLlm({
                  modelRef,
                  system,
                  messages: [
                    ...llmMessages,
                    { role: "assistant", content: lastReply },
                    {
                      role: "user",
                      content:
                        `Your ${OPEN} block is not valid JSON — JSON.parse failed with: ` +
                        `${e instanceof Error ? e.message : String(e)}\n` +
                        `Re-emit the ENTIRE block corrected: reply with only ${OPEN}...${CLOSE} — same content, valid JSON, no prose.`,
                    },
                  ],
                  maxTokens: bigBatch ? taskMaxTokens(settings, "assist") : 2000,
                  feature: "assist",
                  signal: abort.signal,
                })) {
                  if (ev.type === "text") fixed += ev.text;
                }
              } catch (fixupErr) {
                console.error("assist: fixup request failed:", fixupErr);
                break;
              }
              lastReply = fixed;
              const fm = fixed.match(fieldsRe);
              raw = (fm ? fm[1] : fixed).trim();
            }
          }
          if (parsed) {
            send({ type: "fields", fields: normalizeFields(fields) });
          } else {
            const e = parseErr;
            console.error("assist: fields block failed to parse:", e);
            send({
              type: "text",
              text: truncated
                ? "\n(My reply hit the response length limit before the fields were complete — ask me to continue, or to produce fewer items at a time.)"
                : lastPartialJson
                  ? "\n(I produced malformed field data — the form holds what parsed cleanly along the way; ask me to try again for the rest.)"
                  : "\n(I produced malformed field data — ask me to try again.)",
            });
          }
        } else if (truncated) {
          send({
            type: "text",
            text: "\n(My reply hit the response length limit — ask me to continue.)",
          });
        }
        send({ type: "done" });
      } catch (e) {
        if (!abort.signal.aborted)
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
});
