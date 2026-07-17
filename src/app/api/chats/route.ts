import { bad, handler, ok } from "@/lib/api";
import { substitutePlaceholders } from "@/lib/ai/placeholders";
import { toPureChat } from "@/lib/ai/pureChat";
import { entranceSceneId } from "@/lib/stage";
import {
  appendMessage,
  clampLimit,
  getCharacter,
  getLocation,
  getPersona,
  getScene,
  getStory,
  pageChats,
  saveChat,
} from "@/lib/store";
import type { ChatMode, StorySnapshot } from "@/lib/types";

export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const page = await pageChats({
    q: sp.get("q") ?? undefined,
    folder: sp.get("folder") ?? undefined,
    kind: kind === "chats" || kind === "playthroughs" ? kind : undefined,
    limit: clampLimit(sp.get("limit")),
    cursor: sp.get("cursor"),
  });
  const items = [];
  for (const c of page.items) {
    const characterNames: string[] = [];
    for (const id of c.characterIds)
      characterNames.push((await getCharacter(id))?.name ?? c.nameSnapshots[id] ?? "?");
    items.push({
      ...c,
      storySnapshot: undefined, // heavy; the chat page fetches it via /api/chats/[id]
      characterNames,
      personaName: c.personaId
        ? ((await getPersona(c.personaId))?.name ?? null)
        : c.personaCharacterId
          ? (c.nameSnapshots[c.personaCharacterId] ?? null)
          : null,
    });
  }
  return ok({
    items,
    nextCursor: page.nextCursor,
  });
});

export const POST = handler(async (req: Request) => {
  const b = await req.json();
  const mode: ChatMode = ["casual", "immersive", "story"].includes(b.mode) ? b.mode : "casual";

  let storyId: string | null = null;
  let sceneId: string | null = null;
  let locationId: string | null = null;
  let characterIds: string[] = Array.isArray(b.characterIds) ? b.characterIds : [];
  let personaId: string | null = b.personaId ?? null;
  let personaCharacterId: string | null = null;
  let lorebookIds: string[] = Array.isArray(b.lorebookIds) ? b.lorebookIds : [];
  let narratorEnabled = !!b.narratorEnabled;
  let storySnapshot: StorySnapshot | null = null;
  let defaultTitle = "New chat";
  // immersive only: the user takes the narrator's seat — no AI narrator, no persona
  // (casual is pure chat and has no narrator seat; story mode's narrator directs)
  const playAsNarrator = mode === "immersive" && !!b.playAsNarrator;
  if (playAsNarrator) {
    if (!characterIds.length) return bad("Playing as the narrator needs at least one character to narrate to");
    narratorEnabled = false;
    personaId = null;
  }

  if (mode === "casual") {
    // pure chat: texting the characters like real people — no narrator, no POV, no
    // setting, no roleplay conventions (enforced here, not just absent from the wizard)
    narratorEnabled = false;
    if (!characterIds.length)
      return bad("A casual chat needs at least one character — there is no narrator to carry it");
  } else if (mode === "immersive") {
    // setting optional (no setting = the default backdrop); when given, it must resolve
    if (b.sceneId) {
      if (!(await getScene(b.sceneId))) return bad("Scene not found");
      sceneId = b.sceneId;
    } else if (b.locationId) {
      if (!(await getLocation(b.locationId))) return bad("Location not found");
      locationId = b.locationId;
    }
    if (!characterIds.length && !narratorEnabled)
      return bad("An immersive chat needs at least one character, or the narrator enabled");
  } else {
    // story mode = a playthrough: the story is already a self-contained document,
    // so the snapshot is a frozen copy of it (saveStory keeps its internal
    // references self-healed — nothing to resolve against the library)
    const story = b.storyId ? await getStory(b.storyId) : null;
    if (!story) return bad("A playthrough requires a story");
    storyId = story.id;
    narratorEnabled = true; // the narrator directs playthroughs — always on

    storySnapshot = {
      name: story.name,
      description: story.description,
      destination: story.destination,
      secrets: story.secrets,
      characters: story.characters,
      scenes: story.scenes,
      locations: story.locations,
      lorebooks: story.lorebooks,
    };

    if (b.personaCharacterId) {
      if (!story.characters.some((c) => c.id === b.personaCharacterId))
        return bad("The played character must be part of the story's cast");
      personaCharacterId = b.personaCharacterId;
      personaId = null;
    }
    characterIds = story.characters.map((c) => c.id).filter((id) => id !== personaCharacterId);
    lorebookIds = []; // the snapshot carries the story's lorebooks
    // optional starting scene (defaults to the first)
    if (b.sceneId) {
      if (!story.scenes.some((s) => s.id === b.sceneId))
        return bad("Starting scene must belong to the story");
      sceneId = b.sceneId;
    }
    // played cast member: play opens at their ENTRANCE — the chosen scene if they
    // are in its cast, else their first authored scene, never earlier ground
    // (immersion rule; no scene listing them = fail-soft, default start stands)
    if (personaCharacterId) {
      const entrance = entranceSceneId(
        story.scenes.map(({ id, cast }) => ({ id, cast })),
        personaCharacterId,
        sceneId
      );
      if (entrance) sceneId = entrance;
    }

    // playthroughs are titled deterministically, never by the AI titler: a playthrough
    // prefix plus whom the user plays (the story itself when spectating)
    const playedName = personaCharacterId
      ? storySnapshot.characters.find((c) => c.id === personaCharacterId)?.name
      : personaId
        ? (await getPersona(personaId))?.name
        : null;
    defaultTitle = `Playthrough — ${playedName ?? story.name}`;
  }

  // display-name fallback so history stays readable after a library character is deleted
  const nameSnapshotEntries: [string, string][] = [];
  for (const id of [...characterIds, ...(personaCharacterId ? [personaCharacterId] : [])]) {
    const name = storySnapshot?.characters.find((c) => c.id === id)?.name ?? (await getCharacter(id))?.name;
    if (name) nameSnapshotEntries.push([id, name]);
  }
  const nameSnapshots = Object.fromEntries(nameSnapshotEntries);

  const chat = await saveChat({
    title: b.title || defaultTitle,
    mode,
    characterIds,
    personaId,
    personaCharacterId,
    storyId,
    sceneId,
    locationId,
    storySnapshot,
    nameSnapshots,
    lorebookIds,
    narratorEnabled,
    playAsNarrator,
    language: b.language ?? "",
    // casual chats have no POV — every line is literally its sender's own typed words
    pov: mode === "casual" ? "" : (b.pov ?? ""),
    modelId: b.modelId ?? null,
    charModels: b.charModels ?? {},
    folder: b.folder ?? "",
    tags: b.tags ?? [],
    overrides: b.overrides ?? {},
  });

  // greeting: opt-in, single-character shapes only — a casual 1:1 (the greeting passes
  // through the pure-chat transform like everything else injected in that mode) or an
  // immersive 1:1 without narrator (everywhere else the narrator opens the chat,
  // triggered by the client — and when the USER is the narrator, the move is theirs)
  if (mode !== "story" && !narratorEnabled && !playAsNarrator && characterIds.length === 1 && b.greetings === true) {
    const c = await getCharacter(characterIds[0]);
    if (c?.greeting) {
      const persona = personaId ? await getPersona(personaId) : null;
      const greeting = substitutePlaceholders(c.greeting, {
        characterNames: [c.name],
        selfName: c.name,
        userName: persona?.name,
      });
      await appendMessage({
        chatId: chat.id,
        role: "character",
        characterId: c.id,
        content: mode === "casual" ? toPureChat(greeting) : greeting,
        emotion: mode === "casual" ? null : "neutral",
      });
    }
  }
  return ok(chat);
});
