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
  customExpressions: CustomExpression[];
  typingSfxAsset: string | null;
  /** affinity/relationship tracking with personas (global per character) */
  trackRelationship: boolean;
  /** subtle breathing idle motion on the VN stage */
  idleMotion: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

/** Per-location/scene coloring for the chat UI; applied while the place is active
 *  when the global stageStyleEnabled switch is on. All fields optional. */
export interface StageStyle {
  /** true = apply the colors in chat; absent/false = configured but off (the default) */
  enabled?: boolean | null;
  /** stage background color — shown when there's no artwork, and under it while it loads */
  background?: string | null;
  /** floating chat panel background color */
  panelTint?: string | null;
  /** floating chat panel background opacity, 0..1 (default matches the app's ~0.45) */
  panelOpacity?: number | null;
  /** message bubble background inside the chat panel (and the fullscreen-VN dialogue box) */
  messageTint?: string | null;
  /** message text color inside the bubbles (and the fullscreen-VN dialogue box) */
  textColor?: string | null;
  /** text & icons on the panel itself — title, character names, action icons, muted text */
  panelTextColor?: string | null;
  /** accent color inside the chat panel (speaker highlights, primary buttons) */
  accent?: string | null;
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
  createdAt: number;
  updatedAt: number;
}

export interface Story {
  id: string;
  name: string;
  description: string;
  sceneIds: string[];
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
  createdAt: number;
  updatedAt: number;
}

export type Pov = "user1st" | "third" | "vn2nd";

export interface ChatOverrides {
  contextBudget?: number;
  verbatimShare?: number;
  chunkThreshold?: number;
  /** characters may chain @mentions without the per-request turn cap; toggling it off stops a running chain after the current reply */
  infiniteMentions?: boolean;
}

/**
 * story: a story is required, scene switching within its scenes only, no location control.
 * scene: one fixed scene, no switching. location: one fixed location. casual: none of these.
 */
export type ChatMode = "story" | "scene" | "location" | "casual";

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

export interface SceneEvent {
  kind: "scene" | "location";
  sceneId?: string | null;
  locationId?: string | null;
}

export interface MessageVariant {
  content: string;
  emotion: string | null;
  options: string[] | null;
  createdAt: number;
}

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

export interface Checkpoint {
  id: string;
  chatId: string;
  messageId: string;
  name: string;
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
  | "title";

export const AI_TASKS: AiTask[] = [
  "chat",
  "narrator",
  "orchestrator",
  "memory",
  "assist",
  "impersonate",
  "title",
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
  /** backdrop blur behind the floating chat panel */
  chatPanelBlur: boolean;
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
  chatPanelBlur: true,
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
