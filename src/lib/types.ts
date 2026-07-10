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
  personality: string;
  greeting: string;
  exampleDialogue: string;
  /** emotion name -> asset id */
  sprites: Record<string, string>;
  customExpressions: CustomExpression[];
  typingSfxAsset: string | null;
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

export interface Location {
  id: string;
  name: string;
  description: string;
  artworkAsset: string | null;
  bgmAsset: string | null;
  ambientAsset: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Scene {
  id: string;
  name: string;
  setup: string;
  locationId: string | null;
  artworkAsset: string | null;
  bgmAsset: string | null;
  ambientAsset: string | null;
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
}

export interface Chat {
  id: string;
  title: string;
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
