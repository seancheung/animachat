import { describe, expect, it } from "vitest";
import {
  addressedManuscriptCharacters,
  buildManuscriptCharacterRequest,
  buildManuscriptOrchestratorRequest,
  tagManuscriptConversationMentions,
} from "./manuscriptConversation";
import type { ManuscriptCharacter, ManuscriptConversationMessage } from "@/lib/types";

const cast: ManuscriptCharacter[] = [
  { id: "mira", name: "Mira", description: "Alchemist", personality: "Guarded", appearance: "Apron", voice: "Dry" },
  { id: "kael", name: "Kael", description: "Collector", personality: "Patient", appearance: "Coat", voice: "Measured" },
];

const userMessage = (content: string): ManuscriptConversationMessage => ({
  role: "user",
  characterId: null,
  content,
  createdAt: 1,
});

describe("manuscript conversation routing", () => {
  it("routes exact author mentions without the orchestrator", () => {
    const tagged = tagManuscriptConversationMentions("Ask @Kael, then @Mira", cast);
    expect(addressedManuscriptCharacters(tagged, cast).map((character) => character.id))
      .toEqual(["kael", "mira"]);
  });

  it("routes @all in fixed cast order", () => {
    const tagged = tagManuscriptConversationMentions("@all What do you think?", cast);
    expect(addressedManuscriptCharacters(tagged, cast).map((character) => character.id))
      .toEqual(["mira", "kael"]);
  });

  it("gives the orchestrator candidate ids and an author-labelled transcript", () => {
    const request = buildManuscriptOrchestratorRequest([userMessage("Who should answer?")], cast);
    expect(request.system).toContain('"mira" = Mira');
    expect(request.messages[0].content).toContain("Author: Who should answer?");
  });

  it("builds each character history from that character's own seat", () => {
    const messages: ManuscriptConversationMessage[] = [
      userMessage("Hello"),
      { role: "character", characterId: "mira", content: "Welcome.", createdAt: 2 },
      { role: "character", characterId: "kael", content: "Careful.", createdAt: 3 },
    ];
    const request = buildManuscriptCharacterRequest({ title: "Debt" }, messages, cast, cast[0], "English");
    expect(request.system).toContain("The user is the author");
    expect(request.messages).toEqual([
      { role: "user", content: "Author: Hello" },
      { role: "assistant", content: "Welcome." },
      { role: "user", content: "Kael: Careful." },
    ]);
  });
});
