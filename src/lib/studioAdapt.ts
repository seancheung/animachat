import { normalizeCharacter, normalizeScene } from "./storyDoc";
import { normalizeManuscriptChapter, normalizeManuscriptCharacter } from "./manuscript";
import type { Manuscript, Story, StoryScene } from "./types";

export function storyToManuscriptDraft(story: Story): Partial<Manuscript> {
  const synopsis = [
    story.description.trim(),
    story.destination.trim() ? `Story direction: ${story.destination.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    name: `${story.name} — Manuscript`,
    synopsis,
    perspective: "third-limited",
    style: "",
    modelId: null,
    chapters: story.scenes.length
      ? story.scenes.map((scene) => normalizeManuscriptChapter({ title: scene.name, content: "" }))
      : [normalizeManuscriptChapter({ title: "Chapter 1" })],
    characters: story.characters.map((character) => normalizeManuscriptCharacter({
      name: character.name,
      description: character.description,
      personality: character.innerSelf,
      appearance: character.imagePrompt,
      voice: character.exampleDialogue,
    })),
    sessions: [],
    tags: [...story.tags],
  };
}

export function manuscriptToStoryDraft(manuscript: Manuscript): Partial<Story> {
  const characters = manuscript.characters.map((character) => normalizeCharacter({
    name: character.name,
    description: [character.description, character.appearance].filter(Boolean).join("\n\n"),
    innerSelf: character.personality,
    exampleDialogue: character.voice,
  }));
  const cast = characters.map((character) => character.id);
  const scenes: StoryScene[] = manuscript.chapters.map((chapter) => ({
    ...normalizeScene({ name: chapter.title }),
    cast: [...cast],
    goal: chapter.content.trim()
      ? `Adapt the events of “${chapter.title}” into interactive play without forcing the manuscript's exact outcome.`
      : "",
    obstacles: "",
    exit: "",
    pressures: "",
    successors: [],
  }));

  return {
    name: `${manuscript.name} — Interactive`,
    description: manuscript.synopsis,
    destination: "",
    secrets: [],
    characters,
    scenes,
    locations: [],
    lorebooks: [],
    tags: [...manuscript.tags],
  };
}
