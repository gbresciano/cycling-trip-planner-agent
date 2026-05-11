// Conversation state — the single thing the orchestrator threads through
// every turn. `ConversationMessage.content` deliberately mirrors
// Anthropic's content-block shape (text + tool_use + tool_result) so the
// full agent trace is replayable: we can send the entire message history
// back to Claude each turn without reconstructing tool calls from a
// separate log.

import { randomUUID } from "node:crypto";
import type { IsoDateTime, TripPlan, TripPreferences } from "./trip.js";

export type ConversationRole = "user" | "assistant";

// Coarse state machine. The orchestrator advances this as the
// conversation moves: gathering_preferences → planning → ready, with
// `needs_clarification` when the agent paused for a follow-up question
// and `error` reserved for max-iteration bailouts.
export type ConversationStatus =
  | "gathering_preferences"
  | "planning"
  | "ready"
  | "needs_clarification"
  | "error";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  toolUseId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResultContent {
  type: "tool_result";
  toolUseId: string;
  output: string;
  isError?: boolean;
}

// Discriminated union over `type`. Narrows cleanly in switch statements
// and maps 1:1 to Anthropic's content blocks via `agent/orchestrator.ts`.
export type ConversationContent =
  | TextContent
  | ToolUseContent
  | ToolResultContent;

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: ConversationContent[];
  createdAt: IsoDateTime;
}

export interface ConversationState {
  id: string;
  status: ConversationStatus;
  messages: ConversationMessage[];
  preferences: Partial<TripPreferences>;
  plan: TripPlan | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// Shared empty-state constructor. Lives next to the type so the store
// and the orchestrator agree on what a fresh conversation looks like —
// no risk of one drifting from the other. `now` is overridable for
// deterministic timestamps in tests.
export function createEmptyConversation(
  now: () => Date = () => new Date(),
): ConversationState {
  const iso = now().toISOString();
  return {
    id: randomUUID(),
    status: "gathering_preferences",
    messages: [],
    preferences: {},
    plan: null,
    createdAt: iso,
    updatedAt: iso,
  };
}
