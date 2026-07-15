import { bad, handler, ok } from "@/lib/api";
import { substitutePlaceholders } from "@/lib/ai/placeholders";
import { entranceSceneId } from "@/lib/stage";
import {
  appendMessage,
  clampLimit,
  getCharacter,
  getLocation,
  getLorebook,
  getPersona,
  getScene,
  getStory,
  pageChats,
  saveChat,
} from "@/lib/store";
import type { Character, ChatMode, Location, Lorebook, StorySnapshot } from "@/lib/types";

export const GET = handler((req: Request) => {
  const sp = new URL(req.url).searchParams;
  const page = pageChats({
    q: sp.get("q") ?? undefined,
    folder: sp.get("folder") ?? undefined,
    limit: clampLimit(sp.get("limit")),
    cursor: sp.get("cursor"),
  });
  return ok({
    items: page.items.map((c) => ({
      ...c,
      storySnapshot: undefined, // heavy; the chat page fetches it via /api/chats/[id]
      characterNames: c.characterIds.map((id) => getCharacter(id)?.name ?? c.nameSnapshots[id] ?? "?"),
      personaName: c.personaId
        ? (getPersona(c.personaId)?.name ?? null)
        : c.personaCharacterId
          ? (c.nameSnapshots[c.personaCharacterId] ?? null)
          : null,
    })),
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
  // casual/immersive only: the user takes the narrator's seat — no AI narrator, no persona
  const playAsNarrator = mode !== "story" && !!b.playAsNarrator;
  if (playAsNarrator) {
    if (!characterIds.length) return bad("Playing as the narrator needs at least one character to narrate to");
    narratorEnabled = false;
    personaId = null;
  }

  if (mode === "casual") {
    // characters optional when the narrator carries the chat (solo / text-adventure)
    if (!characterIds.length && !narratorEnabled)
      return bad("A casual chat needs at least one character, or the narrator enabled");
  } else if (mode === "immersive") {
    if (b.sceneId && getScene(b.sceneId)) sceneId = b.sceneId;
    else if (b.locationId && getLocation(b.locationId)) locationId = b.locationId;
    else return bad("An immersive chat requires a scene or a location");
    if (!characterIds.length && !narratorEnabled)
      return bad("An immersive chat needs at least one character, or the narrator enabled");
  } else {
    // story mode = a playthrough: freeze the whole story bundle into a snapshot
    const story = b.storyId ? getStory(b.storyId) : null;
    if (!story) return bad("A playthrough requires a story");
    storyId = story.id;
    narratorEnabled = true; // the narrator directs playthroughs — always on

    const characters = story.characterIds
      .map(getCharacter)
      .filter((c): c is Character => !!c);
    const scenes = story.scenes.flatMap(
      ({ sceneId: sid, cast, goal, obstacles, exit, pressures, successors }) => {
        const scene = getScene(sid);
        return scene
          ? [
              {
                scene,
                cast: cast.filter((id) => story.characterIds.includes(id)),
                goal,
                obstacles,
                exit,
                pressures,
                successors,
              },
            ]
          : [];
      }
    );
    // a successor whose scene didn't make it into the snapshot is a dead road — drop it
    const snapshotSceneIds = new Set(scenes.map(({ scene }) => scene.id));
    for (const e of scenes) e.successors = e.successors.filter((s) => snapshotSceneIds.has(s.sceneId));
    const locations = [
      ...new Set(scenes.map(({ scene }) => scene.locationId).filter((id): id is string => !!id)),
    ]
      .map(getLocation)
      .filter((l): l is Location => !!l);
    const lorebooks = story.lorebookIds.map(getLorebook).filter((l): l is Lorebook => !!l);
    storySnapshot = {
      name: story.name,
      description: story.description,
      destination: story.destination,
      secrets: story.secrets,
      characters,
      scenes,
      locations,
      lorebooks,
    };

    if (b.personaCharacterId) {
      if (!characters.some((c) => c.id === b.personaCharacterId))
        return bad("The played character must be part of the story's cast");
      personaCharacterId = b.personaCharacterId;
      personaId = null;
    }
    characterIds = characters.map((c) => c.id).filter((id) => id !== personaCharacterId);
    lorebookIds = story.lorebookIds;
    // optional starting scene (defaults to the first)
    if (b.sceneId) {
      if (!scenes.some(({ scene }) => scene.id === b.sceneId))
        return bad("Starting scene must belong to the story");
      sceneId = b.sceneId;
    }
    // played cast member: play opens at their ENTRANCE — the chosen scene if they
    // are in its cast, else their first authored scene, never earlier ground
    // (immersion rule; no scene listing them = fail-soft, default start stands)
    if (personaCharacterId) {
      const entrance = entranceSceneId(
        scenes.map(({ scene, cast }) => ({ id: scene.id, cast })),
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
        ? getPersona(personaId)?.name
        : null;
    defaultTitle = `Playthrough — ${playedName ?? story.name}`;
  }

  // display-name fallback so history stays readable after a library character is deleted
  const nameSnapshots = Object.fromEntries(
    [...characterIds, ...(personaCharacterId ? [personaCharacterId] : [])].flatMap((id) => {
      const name = storySnapshot?.characters.find((c) => c.id === id)?.name ?? getCharacter(id)?.name;
      return name ? [[id, name]] : [];
    })
  );

  const chat = saveChat({
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
    pov: b.pov ?? "",
    modelId: b.modelId ?? null,
    charModels: b.charModels ?? {},
    folder: b.folder ?? "",
    tags: b.tags ?? [],
    overrides: b.overrides ?? {},
  });

  // greeting: opt-in, and only for the one shape it suits — a casual 1:1 without narrator
  // (everywhere else the narrator opens the chat, triggered by the client — and when the
  // USER is the narrator, the opening move is theirs)
  if (mode === "casual" && !narratorEnabled && !playAsNarrator && characterIds.length === 1 && b.greetings === true) {
    const c = getCharacter(characterIds[0]);
    if (c?.greeting) {
      const persona = personaId ? getPersona(personaId) : null;
      appendMessage({
        chatId: chat.id,
        role: "character",
        characterId: c.id,
        content: substitutePlaceholders(c.greeting, {
          characterNames: [c.name],
          selfName: c.name,
          userName: persona?.name,
        }),
        emotion: "neutral",
      });
    }
  }
  return ok(chat);
});
