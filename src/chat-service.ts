// Application service that wires the store and the orchestrator together
// for the HTTP layer. The /chat route handler stays thin by delegating
// the get-or-create → orchestrate → save sequence here.

import type { Orchestrator } from "../agent/index.js";
import type {
  ConversationMessage,
  ConversationState,
  TripPlan,
} from "./domain/index.js";
import {
  ConversationNotFoundError,
  type ConversationStore,
} from "./conversation-store.js";

export interface ChatInput {
  conversationId?: string;
  message: string;
}

// Flat shape designed for transport: tool inputs and outputs are already
// parsed so the client doesn't have to walk the message tree to render a
// debug panel.
export interface ToolCallDebug {
  name: string;
  input: unknown;
  output: unknown;
  isError?: boolean;
}

export interface ChatResult {
  conversationId: string;
  assistantMessage: string;
  state: ConversationState;
  plan: TripPlan | null;
  toolCalls: ToolCallDebug[];
}

export class ChatService {
  constructor(
    private readonly store: ConversationStore,
    private readonly orchestrator: Orchestrator,
  ) {}

  async chat(input: ChatInput): Promise<ChatResult> {
    // Two entry paths: caller supplies an id (continue an existing
    // conversation) or doesn't (start a new one). We fail loud on
    // unknown ids — an unknown id from the client almost always means
    // the client is confused, and silently upserting would hide that.
    const state = input.conversationId
      ? this.requireConversation(input.conversationId)
      : this.store.create();

    // Remember the message count *before* the turn so we can slice off
    // exactly the new messages and extract this turn's tool calls.
    const before = state.messages.length;

    const turn = await this.orchestrator.sendMessage(state, input.message);
    const saved = this.store.update(turn.state);
    const turnMessages = saved.messages.slice(before);

    return {
      conversationId: saved.id,
      assistantMessage: turn.reply,
      state: saved,
      plan: turn.plan,
      toolCalls: extractToolCalls(turnMessages),
    };
  }

  private requireConversation(id: string): ConversationState {
    const existing = this.store.get(id);
    if (!existing) throw new ConversationNotFoundError(id);
    return existing;
  }
}

// Pair `tool_use` blocks with their matching `tool_result` blocks by id.
// Tool outputs were JSON-stringified by the orchestrator before being
// sent back to Claude; we parse them here so the debug payload is
// structured rather than a wall of escaped JSON.
function extractToolCalls(messages: ConversationMessage[]): ToolCallDebug[] {
  const pendingByUseId = new Map<string, { name: string; input: unknown }>();
  const calls: ToolCallDebug[] = [];

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use") {
        pendingByUseId.set(block.toolUseId, {
          name: block.toolName,
          input: block.input,
        });
      } else if (block.type === "tool_result") {
        const use = pendingByUseId.get(block.toolUseId);
        if (!use) continue;
        pendingByUseId.delete(block.toolUseId);
        calls.push({
          name: use.name,
          input: use.input,
          output: tryParseJson(block.output),
          ...(block.isError ? { isError: true } : {}),
        });
      }
    }
  }

  return calls;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
