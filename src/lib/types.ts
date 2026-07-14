export type ProviderType = "anthropic" | "openai";

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  createdAt: number;
}

export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  /** USD per million tokens; null = unpriced (usage dashboard shows tokens only) */
  inputPrice: number | null;
  /** USD per million cached prompt reads/writes; null = billed at inputPrice
      (right for providers that don't discount/surcharge that leg) */
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  outputPrice: number | null;
  customBody: Record<string, unknown> | null;
  createdAt: number;
}

export interface CustomExpression {
  name: string;
  description: string;
}

export interface Character {
  id: string;
  name: string;
  avatarAsset: string | null;
  /** who the character is: personality, background, mannerisms, anything else */
  description: string;
  greeting: string;
  exampleDialogue: string;
  /** text-to-image prompt for the neutral sprite */
  imagePrompt: string;
  /** emotion name -> asset id */
  sprites: Record<string, string>;
  /** emotion name -> audio asset id; a one-shot SFX (laughter, sigh…) played on the
      VN stage when the character switches to that expression */
  spriteSfx: Record<string, string>;
  customExpressions: CustomExpression[];
  typingSfxAsset: string | null;
  /** affinity/relationship tracking with personas (global per character) */
  trackRelationship: boolean;
  /** subtle breathing idle motion on the VN stage */
  idleMotion: boolean;
  /** free-form labels for grouping & filtering in the library */
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** Per-location/scene palette for the chat UI; applied while the place is active
 *  when the global stageStyleEnabled switch is on. Organized as Bg/Fg surface pairs —
 *  each Fg is the text on its matching Bg (auto-contrast when omitted). All optional.
 *  Colors only — opacity (panel, bubbles) is a system setting, never part of a style. */
export interface StageStyle {
  /** true = apply the colors in chat; absent/false = configured but off (the default) */
  enabled?: boolean | null;
  /** VN stage backdrop — shown when there's no artwork, and under it while it loads; no text sits on it */
  stageBg?: string | null;
  /** floating chat panel & its controls: background */
  panelBg?: string | null;
  /** floating chat panel & its controls: text & icons (title, names, buttons, muted steps) */
  panelFg?: string | null;
  /** message bubbles (and the VN dialogue box): background */
  messageBg?: string | null;
  /** message bubbles (and the VN dialogue box): text */
  messageFg?: string | null;
  /** accent surfaces (primary buttons, slider, focus rings, decorative highlights) */
  accent?: string | null;
  /** text on accent surfaces (e.g. the Send button label) */
  accentFg?: string | null;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  /** text-to-image prompt for the background artwork */
  imagePrompt: string;
  artworkAsset: string | null;
  bgmAsset: string | null;
  ambientAsset: string | null;
  stageStyle: StageStyle | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Scene {
  id: string;
  name: string;
  setup: string;
  /** text-to-image prompt for the background artwork */
  imagePrompt: string;
  locationId: string | null;
  artworkAsset: string | null;
  bgmAsset: string | null;
  ambientAsset: string | null;
  stageStyle: StageStyle | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StoryScene {
  sceneId: string;
  /** roster members (character ids) on stage when the scene opens — subset of the story's characterIds */
  cast: string[];
}

export interface Story {
  id: string;
  name: string;
  description: string;
  /** ordered roster — drives [charN_name] in playthroughs and the play-as picker */
  characterIds: string[];
  scenes: StoryScene[];
  lorebookIds: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LorebookEntry {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  /** how many recent messages to scan for keywords */
  scanDepth: number;
}

export interface Lorebook {
  id: string;
  name: string;
  description: string;
  entries: LorebookEntry[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type Pov = "user1st" | "third" | "vn2nd";

/**
 * panel: chat log in a floating side panel on the right (the default).
 * dialogue: VN-style dialogue box + input centered at the bottom of the stage,
 * advancing message by message. Presentation only — switchable anytime.
 */
export type ChatLayout = "panel" | "dialogue";

export interface ChatOverrides {
  contextBudget?: number;
  verbatimShare?: number;
  chunkThreshold?: number;
  /** characters may chain @mentions without the per-request turn cap; toggling it off stops a running chain after the current reply */
  infiniteMentions?: boolean;
  /** chat layout — side panel (default) or VN dialogue box */
  layout?: ChatLayout;
}

/**
 * casual: no setting (characters optional when the narrator is enabled — solo/text-adventure).
 * immersive: one fixed scene OR location, never switches.
 * story: a playthrough of a story — narrator required and in sole control of scene
 * progression, presence and the ending; runs off a self-contained snapshot.
 */
export type ChatMode = "casual" | "immersive" | "story";

/**
 * Self-contained copy of a story taken when a playthrough is created. Playthroughs
 * never read the library afterwards: deleting or editing library items can't touch a
 * running or finished playthrough. Media stay content-addressed asset ids (never
 * copied); the storage prune counts snapshot references as used.
 */
export interface StorySnapshot {
  name: string;
  description: string;
  /** full sheets in roster order (includes the played character, if any) */
  characters: Character[];
  /** ordered scene sequence; cast = character ids on stage when the scene opens */
  scenes: { scene: Scene; cast: string[] }[];
  /** locations referenced by the scenes */
  locations: Location[];
  lorebooks: Lorebook[];
}

export interface Chat {
  id: string;
  title: string;
  mode: ChatMode;
  folder: string;
  tags: string[];
  storyId: string | null;
  sceneId: string | null;
  locationId: string | null;
  lorebookIds: string[];
  characterIds: string[];
  personaId: string | null;
  /** story mode: play as this roster member instead of a persona (resolved from the snapshot) */
  personaCharacterId: string | null;
  /** story mode: the frozen story bundle this playthrough runs on */
  storySnapshot: StorySnapshot | null;
  /** characterId -> name at creation; display fallback after a library character is deleted */
  nameSnapshots: Record<string, string>;
  modelId: string | null;
  /** per-character model override for group chats: characterId -> modelId */
  charModels: Record<string, string>;
  language: string;
  pov: Pov | "";
  narratorEnabled: boolean;
  overrides: ChatOverrides;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = "user" | "character" | "narrator" | "marker";

/**
 * Stage-affecting metadata on a narrator message, parsed from its structured tags.
 * All stage state (current scene, who's present, whether the story has ended) is
 * derived by folding these events over the timeline — never stored mutably.
 */
export interface SceneEvent {
  /** <next-scene/>: the story advanced to this scene (id within the playthrough snapshot) */
  sceneId?: string | null;
  /** <enter>: character ids brought on stage mid-scene */
  enter?: string[];
  /** <leave>: character ids sent off stage mid-scene */
  leave?: string[];
  /** <the-end/>: the playthrough concluded */
  theEnd?: boolean;
}

export interface MessageVariant {
  content: string;
  emotion: string | null;
  options: string[] | null;
  createdAt: number;
}
// The model's raw output before tag parsing lives in the raw_outputs table
// (message_id + variant_index), NOT on the variant: debugging data that must
// never reach the client, forks, or archives — keeping it out of the variants
// JSON makes that true by construction.

export interface Message {
  id: string;
  chatId: string;
  position: number;
  role: MessageRole;
  characterId: string | null;
  variants: MessageVariant[];
  activeVariant: number;
  sceneEvent: SceneEvent | null;
  createdAt: number;
}

export interface Relationship {
  id: string;
  characterId: string;
  personaId: string;
  affinity: number; // -100..100
  notes: string;
  updatedAt: number;
}

/** A character's (directed) view of another character. */
export interface CharRelationship {
  id: string;
  characterId: string;
  otherId: string;
  affinity: number; // -100..100
  notes: string;
  updatedAt: number;
}

export interface Fact {
  id: string;
  characterId: string;
  chatId: string | null;
  content: string;
  createdAt: number;
}

export type AiTask =
  | "chat"
  | "narrator"
  | "orchestrator"
  | "memory"
  | "assist"
  | "impersonate"
  | "title"
  | "novelize";

export const AI_TASKS: AiTask[] = [
  "chat",
  "narrator",
  "orchestrator",
  "memory",
  "assist",
  "impersonate",
  "title",
  "novelize",
];

export interface Settings {
  defaultModelId: string | null;
  taskModels: Partial<Record<AiTask, string | null>>;
  language: string;
  pov: Pov;
  contextBudgetCap: number;
  verbatimShare: number;
  chunkThreshold: number;
  outputReserve: number;
  typingSfxEnabled: boolean;
  /** VN typewriter reveal, in characters per second; 0 = off (text appears as it streams in) */
  typingSpeed: number;
  /** music channel: the active scene/location BGM, 0..1 */
  bgmVolume: number;
  /** sound-effects channel: ambient loops and typing blips, 0..1 */
  sfxVolume: number;
  /** master mute — silences both channels (the chat's corner button toggles it) */
  audioMuted: boolean;
  /** backdrop blur behind the floating chat panel */
  chatPanelBlur: boolean;
  /** background opacity of the floating chat panel & the VN dialogue box, 0..1 */
  chatPanelOpacity: number;
  /** let the active scene/location color the VN stage & chat panel (their stageStyle) */
  stageStyleEnabled: boolean;
  /** track user(persona)↔character affinity; off = no updates, no prompt injection */
  userRelationshipsEnabled: boolean;
  /** track affinity between characters (group chats); off = no updates, no prompt injection */
  charRelationshipsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultModelId: null,
  taskModels: {},
  language: "English",
  pov: "user1st",
  contextBudgetCap: 32000,
  verbatimShare: 0.35,
  chunkThreshold: 3000,
  outputReserve: 2000,
  typingSfxEnabled: true,
  typingSpeed: 60,
  bgmVolume: 0.8,
  sfxVolume: 0.8,
  audioMuted: false,
  chatPanelBlur: true,
  chatPanelOpacity: 0.3,
  stageStyleEnabled: true,
  userRelationshipsEnabled: true,
  charRelationshipsEnabled: true,
};

export const EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "embarrassed",
  "thoughtful",
  "fearful",
  "disgusted",
  "smug",
  "excited",
  "tired",
] as const;

export const POV_LABELS: Record<Pov, string> = {
  user1st: "User 1st person, characters 3rd",
  third: "Everyone 3rd person",
  vn2nd: "2nd person (visual novel)",
};
