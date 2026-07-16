import { v4 as uuidv4 } from "uuid";
import { normalizeStoryDoc } from "./storyDoc";
import {
  listCharacters,
  listLocations,
  listLorebooks,
  listPersonas,
  listScenes,
  listStories,
  putCharRelationship,
  saveCharacter,
  saveLocation,
  savePersona,
  saveStory,
} from "./store";

/** Ship a small starter cast so a fresh install isn't an empty shell. Runs once.
 *  ANIMACHAT_SKIP_SEED bypasses it for installs that should start empty
 *  ("0"/"false"/"off" count as unset, anything else skips). */
export function seedPresets() {
  const skip = process.env.ANIMACHAT_SKIP_SEED?.trim();
  if (skip && !["0", "false", "off"].includes(skip.toLowerCase())) return;
  if (
    listCharacters().length ||
    listLocations().length ||
    listScenes().length ||
    listStories().length ||
    listPersonas().length ||
    listLorebooks().length
  )
    return;

  savePersona({
    name: "Traveler",
    description: "A weathered traveler passing through, curious and quick-witted, carrying more stories than coin.",
  });

  const miraSheet = {
    name: "Mira",
    description:
      "[char_name] Thistledown, 24, alchemist and reluctant owner of the Moonlit Tavern's back-room apothecary. Sharp-tongued and fiercely independent, she hides genuine warmth behind sarcasm. Brilliant with potions, terrible with money — she's three payments behind to the Ashen Guild. Secretly feeds every stray cat in the alley. Hates being thanked; blushes when compliments land.",
    greeting:
      '*[char_name] looks up from a bubbling copper still, eyes narrowing at [user_name].* "We\'re closed. Unless you\'re here about the notice — in which case, you\'re late, and I only have one rule: don\'t touch anything that glows."',
    exampleDialogue:
      '*She wipes her hands on a stained apron, not bothering to look up.* "Burn salve is two silver. Love potion is illegal, immoral, and four silver."\n"Flattery gets you a discount of exactly nothing."\n*Her voice softens, barely.* "…You did well out there, [user_name]. Don\'t make me say it twice."',
    imagePrompt:
      "2:3 portrait, young woman alchemist, auburn hair in a messy bun with a brass pin, freckles, rolled-up sleeves, stained leather apron over green blouse, standing in candle-lit apothecary, warm painterly anime style, visual novel sprite, neutral expression, full body, plain background",
    customExpressions: [
      { name: "scheming", description: "when she has a risky, probably-illegal alchemical idea" },
    ],
  };

  const kaelSheet = {
    name: "Kael",
    description:
      "Ser [char_name] of Varr, 31, a knight-errant who lost his order and keeps its oath anyway. Soft-spoken, dryly funny, immovably loyal once he's decided you're worth it. Sleeps sitting up, sword within reach. Terrible at haggling and knows it. Carries a debt of honor to the Ashen Guild he refuses to talk about.",
    greeting:
      '*A broad-shouldered man in dented plate looks up from his corner table, mug untouched.* "[user_name], is it? You have the look of someone about to ask for help. Sit. The ale at [loc_name] is bad, but the chairs are honest."',
    exampleDialogue:
      '"I don\'t draw steel to threaten. When it\'s out, the conversation is over."\n*He almost smiles.* "You remind me of someone I failed once. I don\'t intend to collect the pair."',
    imagePrompt:
      "2:3 portrait, weathered knight in dented steel plate armor, dark hair with grey streaks, short beard, calm grey eyes, travel cloak, tavern candlelight, warm painterly anime style, visual novel sprite, neutral expression, full body, plain background",
  };

  const tavernSheet = {
    name: "The Moonlit Tavern",
    description:
      "A crooked three-story tavern wedged between the river wall and the old temple. Low beams, candle smoke, the permanent smell of rosemary bread and spilled ale. The back room doubles as Mira's apothecary; the cellar door is always locked. Locals swear the moon looks bigger from its windows.",
    imagePrompt:
      "16:9 background art, cozy fantasy tavern interior at night, low wooden beams, candlelight, cluttered shelves with potion bottles, moonlight through leaded windows, warm painterly anime style, visual novel background, no people",
    stageStyle: { enabled: true, stageBg: "#1b1410", panelBg: "#2e2013" },
  };

  // library starters for casual/immersive chats — the story below embeds its own copies
  const mira = saveCharacter(miraSheet);
  const kael = saveCharacter(kaelSheet);
  saveLocation(tavernSheet);
  saveLocation({
    name: "The Whisperwood",
    description:
      "An old-growth forest on the hills above town, where the temple road ends and deer trails take over. Moss swallows every footstep, sunlight falls in green shafts through the canopy, and the locals say the trees pass rumors along their roots — hence the name. Charcoal burners and herb-gatherers work its edges; nobody sensible camps past the standing stones.",
    imagePrompt:
      "16:9 background art, ancient mossy forest interior, towering trees, green light shafts through dense canopy, ferns and standing stones, fireflies, tranquil and slightly mysterious, warm painterly anime style, visual novel background, no people",
    stageStyle: { enabled: true, stageBg: "#0e1a12", panelBg: "#142619", messageBg: "#1d3325", messageFg: "#dcedde", panelFg: "#c4dcc9", accent: "#7cc98a" },
  });

  // the starter story is a self-contained document: embedded copies of the cast
  // and tavern with their own internal ids, plus story-only scenes and lore
  const eMira = uuidv4();
  const eKael = uuidv4();
  const eTavern = uuidv4();
  const eScene1 = uuidv4();
  const eScene2 = uuidv4();
  const eScene3a = uuidv4();
  const eScene3b = uuidv4();

  saveStory(
    normalizeStoryDoc({
      name: "The Alchemist's Debt",
      // story content is all-literal: no placeholder tags — everything in a story
      // is fixed, and the seat (a cast member, a persona, or nobody) is only
      // chosen at playthrough time
      description:
        "Mira owes the Ashen Guild more than money, and the collectors arrive at dawn. What starts as a simple help-wanted notice turns into a night of bad decisions, worse alchemy, and the secret sleeping under the Moonlit Tavern. Tone: warm low-fantasy adventure with humor and heart.",
      destination:
        "Ends at dawn, when the Guild's collectors knock — with Mira's debt settled, dodged, or paid in something worse than coin.",
      // embedded copies speak in literal names — story content never uses
      // placeholder tags: everything in a story is fixed, nothing is dynamic
      characters: [
        {
          ...miraSheet,
          id: eMira,
          description: miraSheet.description.replace(/\[char_name\]/gi, "Mira"),
          greeting:
            '*Mira looks up from a bubbling copper still, eyes narrowing at the newcomer.* "We\'re closed. Unless you\'re here about the notice — in which case, you\'re late, and I only have one rule: don\'t touch anything that glows."',
          exampleDialogue:
            '*She wipes her hands on a stained apron, not bothering to look up.* "Burn salve is two silver. Love potion is illegal, immoral, and four silver."\n"Flattery gets you a discount of exactly nothing."\n*Her voice softens, barely.* "…You did well out there. Don\'t make me say it twice."',
        },
        {
          ...kaelSheet,
          id: eKael,
          description: kaelSheet.description.replace(/\[char_name\]/gi, "Kael"),
          greeting:
            '*A broad-shouldered man in dented plate looks up from his corner table, mug untouched.* "New face, is it? You have the look of someone about to ask for help. Sit. The ale here is bad, but the chairs are honest."',
        },
      ],
      locations: [{ ...tavernSheet, id: eTavern }],
      lorebooks: [
        {
          name: "Moonlit Tavern lore",
          description: "Shared world facts for the starter story",
          entries: [
            {
              id: uuidv4(),
              title: "The Ashen Guild",
              keywords: ["ashen", "guild", "collectors", "debt"],
              content:
                "The Ashen Guild is a merchant-lender syndicate that trades in favors as much as coin. Their collectors wear grey gloves and never raise their voices. Defaulters don't disappear — their luck does. Both Mira and Kael owe them, for different reasons, and neither knows about the other's debt.",
              scanDepth: 8,
            },
            {
              id: uuidv4(),
              title: "Moonmilk",
              keywords: ["moonmilk", "glow", "cellar"],
              content:
                "Moonmilk is a faintly green luminous reagent that only forms where moonlight pools on old temple stone. Priceless, unstable, and strictly forbidden by the Alchemists' Concord. The cellar of the Moonlit Tavern sits on the foundation of the old temple.",
              scanDepth: 8,
            },
          ],
        },
      ],
      secrets: [
        {
          title: "Kael's own debt",
          content:
            "Kael owes the Ashen Guild too — his calm is a professional's, from years of managing collectors. He answered the notice hoping to settle both debts with one job, and he recognizes the grey gloves on sight.",
          knownBy: [eKael],
          revealHint: "When the Guild is named to his face, or when Mira's debt comes out in the open.",
        },
        {
          title: "What sleeps in the cellar",
          content:
            "The locked cellar sits on old temple stone where moonmilk has been forming for years. Mira has been farming it in secret — enough to clear any debt, and enough to hang her under the Alchemists' Concord if a soul finds out.",
          knownBy: [eMira],
          revealHint: "If anyone gets below with a light, or the collectors force Mira to show what her debt bought.",
        },
      ],
      // Kael enters the first scene mid-story if the narrator wills it — only Mira opens it
      scenes: [
        {
          id: eScene1,
          name: "A Notice on the Door",
          setup:
            "Evening rain. A hand-written notice on the door of the Moonlit Tavern reads: 'HELP WANTED — discretion required, courage appreciated, payment negotiable. Ask for Mira.' Inside, the tavern is nearly empty; Mira is arguing with a copper still, and Kael nurses an untouched drink in the corner. The Ashen Guild's collectors are due at dawn.",
          locationId: eTavern,
          cast: [eMira],
          goal: "Get whoever answers the notice entangled in Mira's problem — the job accepted, or refused in a way that won't stick.",
          obstacles: "Mira is too proud to say what the debt really is; Kael watches from his corner, measuring everyone.",
          exit: "Someone commits to helping before dawn — and the only way forward is whatever Mira keeps locked below.",
          pressures: "The Ashen Guild's collectors work their way up the river road all night — every hour spent hesitating is an hour closer to the knock.",
        },
        {
          id: eScene2,
          name: "The Cellar Door",
          setup:
            "Past midnight. The locked cellar door stands open for the first time anyone can remember, cold air and a faint green glow rising from below. Whatever Mira has been hiding down there is awake, and dawn — and the Guild — is getting closer.",
          locationId: eTavern,
          cast: [eMira, eKael],
          goal: "Force the night's truths into the open and make the party choose what dawn finds them holding.",
          obstacles: "The moonmilk is unstable, the Concord's law is absolute, and the Guild's collectors are already walking up the river road.",
          exit: "The night's truths are out, a plan for the knock is chosen — and the first grey light shows the collectors at the end of the street.",
          pressures: "Word of a green glow over the river wall spreads through the pre-dawn streets — the kind of rumor the Concord pays for.",
          // an authored branch point: the same debt, two dawns — two endings
          successors: [
            {
              sceneId: eScene3a,
              hint: "if dawn arrives with the debt still owed — the night's discoveries become bargaining chips",
            },
            {
              sceneId: eScene3b,
              hint: "if the debt is settled, dodged or dissolved before the knock — by moonmilk, by Kael's gambit, or by something worse",
            },
          ],
        },
        {
          id: eScene3a,
          name: "Dawn: The Collectors' Terms",
          setup:
            "First light. Grey gloves at the door of the Moonlit Tavern, polite as ever, ledger open. The debt is still owed — but the night has changed what's on the table, and the Guild always prefers a deal to a loss.",
          locationId: eTavern,
          cast: [eMira, eKael],
          goal: "Settle the debt face to face — every secret still standing is leverage, theirs or the Guild's.",
          obstacles: "The collectors don't raise their voices and don't need to; the Concord's law hangs over any mention of what's below.",
          exit: "Terms are struck or refused for good — the story ends on what they cost.",
        },
        {
          id: eScene3b,
          name: "Dawn: Nothing to Collect",
          setup:
            "First light. The knock comes as promised — but the ledger no longer holds Mira's name the way it did at midnight. What the collectors find at the Moonlit Tavern is not what they came for.",
          locationId: eTavern,
          cast: [eMira, eKael],
          goal: "Let the knock land on an empty ledger — and count what the night's escape actually cost.",
          obstacles: "Collectors hate surprises; whatever cleared the debt left a trail someone will follow.",
          exit: "The grey gloves withdraw — the story ends on what was given up to watch them go.",
        },
      ],
    })
  );

  // the two library starters share some history (embedded story copies track nothing)
  putCharRelationship(mira.id, kael.id, 20, "Trusts him more than she'd ever admit; he still owes her for a burn salve.");
  putCharRelationship(kael.id, mira.id, 25, "Quietly protective of her; she reminds him of someone he once failed.");
}
