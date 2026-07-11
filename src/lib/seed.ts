import {
  listCharacters,
  listLocations,
  listPersonas,
  listScenes,
  listStories,
  putCharRelationship,
  saveCharacter,
  saveLocation,
  saveLorebook,
  savePersona,
  saveScene,
  saveStory,
} from "./store";

/** Ship a small starter cast so a fresh install isn't an empty shell. Runs once. */
export function seedPresets() {
  if (
    listCharacters().length ||
    listLocations().length ||
    listScenes().length ||
    listStories().length ||
    listPersonas().length
  )
    return;

  savePersona({
    name: "Traveler",
    description: "A weathered traveler passing through, curious and quick-witted, carrying more stories than coin.",
  });

  const mira = saveCharacter({
    name: "Mira",
    description:
      "Mira Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern's back-room apothecary. Sharp-tongued and fiercely independent, she hides genuine warmth behind sarcasm. Brilliant with potions, terrible with money — she's three payments behind to the Ashen Guild. Secretly feeds every stray cat in the alley. Hates being thanked; blushes when compliments land.",
    greeting:
      '*Mira looks up from a bubbling copper still, eyes narrowing at [user_name].* "We\'re closed. Unless you\'re here about the notice — in which case, you\'re late, and I only have one rule: don\'t touch anything that glows."',
    exampleDialogue:
      '*She wipes her hands on a stained apron, not bothering to look up.* "Burn salve is two silver. Love potion is illegal, immoral, and four silver."\n"Flattery gets you a discount of exactly nothing."\n*Her voice softens, barely.* "…You did well out there, [user_name]. Don\'t make me say it twice."',
    imagePrompt:
      "2:3 portrait, young woman alchemist, auburn hair in a messy bun with a brass pin, freckles, rolled-up sleeves, stained leather apron over green blouse, standing in candle-lit apothecary, warm painterly anime style, visual novel sprite, neutral expression, full body, plain background",
    customExpressions: [
      { name: "scheming", description: "when she has a risky, probably-illegal alchemical idea" },
    ],
  });

  const kael = saveCharacter({
    name: "Kael",
    description:
      "Ser Kael of Varr, 31, a knight-errant who lost his order and keeps its oath anyway. Soft-spoken, dryly funny, immovably loyal once he's decided you're worth it. Sleeps sitting up, sword within reach. Terrible at haggling and knows it. Carries a debt of honor to the Ashen Guild he refuses to talk about.",
    greeting:
      '*A broad-shouldered man in dented plate looks up from his corner table, mug untouched.* "[user_name], is it? You have the look of someone about to ask for help. Sit. The ale at [loc_name] is bad, but the chairs are honest."',
    exampleDialogue:
      '"I don\'t draw steel to threaten. When it\'s out, the conversation is over."\n*He almost smiles.* "You remind me of someone I failed once. I don\'t intend to collect the pair."',
    imagePrompt:
      "2:3 portrait, weathered knight in dented steel plate armor, dark hair with grey streaks, short beard, calm grey eyes, travel cloak, tavern candlelight, warm painterly anime style, visual novel sprite, neutral expression, full body, plain background",
  });

  const tavern = saveLocation({
    name: "The Moonlit Tavern",
    description:
      "A crooked three-story tavern wedged between the river wall and the old temple. Low beams, candle smoke, the permanent smell of rosemary bread and spilled ale. The back room doubles as Mira's apothecary; the cellar door is always locked. Locals swear the moon looks bigger from its windows.",
    imagePrompt:
      "16:9 background art, cozy fantasy tavern interior at night, low wooden beams, candlelight, cluttered shelves with potion bottles, moonlight through leaded windows, warm painterly anime style, visual novel background, no people",
  });

  const scene1 = saveScene({
    name: "A Notice on the Door",
    setup:
      "Evening rain. A hand-written notice on the door of [loc_name] reads: 'HELP WANTED — discretion required, courage appreciated, payment negotiable. Ask for Mira.' Inside, [loc_name] is nearly empty; Mira is arguing with a copper still, and Kael nurses an untouched drink in the corner. The Ashen Guild's collectors are due at dawn.",
    locationId: tavern.id,
  });

  const scene2 = saveScene({
    name: "The Cellar Door",
    setup:
      "Past midnight. The locked cellar door stands open for the first time anyone can remember, cold air and a faint green glow rising from below. Whatever Mira has been hiding down there is awake, and dawn — and the Guild — is getting closer.",
    locationId: tavern.id,
  });

  saveStory({
    name: "The Alchemist's Debt",
    description:
      "Mira owes the Ashen Guild more than money, and the collectors arrive at dawn. What starts as a simple help-wanted notice pulls [user_name] into a night of bad decisions, worse alchemy, and the secret sleeping under [loc_name]. Tone: warm low-fantasy adventure with humor and heart.",
    sceneIds: [scene1.id, scene2.id],
  });

  saveLorebook({
    name: "Moonlit Tavern lore",
    description: "Shared world facts for the starter story",
    entries: [
      {
        id: crypto.randomUUID(),
        title: "The Ashen Guild",
        keywords: ["ashen", "guild", "collectors", "debt"],
        content:
          "The Ashen Guild is a merchant-lender syndicate that trades in favors as much as coin. Their collectors wear grey gloves and never raise their voices. Defaulters don't disappear — their luck does. Both Mira and Kael owe them, for different reasons, and neither knows about the other's debt.",
        scanDepth: 8,
      },
      {
        id: crypto.randomUUID(),
        title: "Moonmilk",
        keywords: ["moonmilk", "glow", "cellar"],
        content:
          "Moonmilk is a faintly green luminous reagent that only forms where moonlight pools on old temple stone. Priceless, unstable, and strictly forbidden by the Alchemists' Concord. The cellar of [loc_name] sits on the foundation of the old temple.",
        scanDepth: 8,
      },
    ],
  });

  // the two starters share some history
  putCharRelationship(mira.id, kael.id, 20, "Trusts him more than she'd ever admit; he still owes her for a burn salve.");
  putCharRelationship(kael.id, mira.id, 25, "Quietly protective of her; she reminds him of someone he once failed.");
}
