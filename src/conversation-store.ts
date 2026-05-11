// In-memory conversation store.
//
// Conversations are keyed by `ConversationState.id`. The store is the
// only thing in the app that holds long-lived state across requests —
// orchestrator turns return new `ConversationState` values, which the
// API layer hands back to the store via `update`.
//
// The "separation" the spec asks for (raw chat history vs extracted
// preferences vs derived planning data) lives in `ConversationState`
// itself: `messages`, `preferences`, and `plan` are independent fields,
// so callers can read or replace any slice without touching the others.

import {
  createEmptyConversation,
  type ConversationState,
} from "./domain/index.js";

export class ConversationNotFoundError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation '${conversationId}' not found`);
    this.name = "ConversationNotFoundError";
  }
}

export interface ConversationStore {
  create(): ConversationState;
  get(id: string): ConversationState | undefined;
  update(state: ConversationState): ConversationState;
  reset(id: string): ConversationState;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ConversationState>();

  // `now` is injectable so tests can pin timestamps without monkey-
  // patching `Date`.
  constructor(private readonly now: () => Date = () => new Date()) {}

  create(): ConversationState {
    const conversation = createEmptyConversation(this.now);
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  get(id: string): ConversationState | undefined {
    return this.conversations.get(id);
  }

  // `update` takes the whole state (the `id` is on the object). Strict
  // on misses — silently upserting would hide bugs where the caller
  // dropped or mistyped a conversation id. The API layer is expected
  // to call `create()` explicitly before the first `update`.
  update(state: ConversationState): ConversationState {
    if (!this.conversations.has(state.id)) {
      throw new ConversationNotFoundError(state.id);
    }
    this.conversations.set(state.id, state);
    return state;
  }

  // `reset` wipes messages, preferences, and plan but keeps the id and
  // original `createdAt`, so a client can continue using the same id
  // for a fresh conversation. Use `update` with a manually emptied
  // state if you need different semantics.
  reset(id: string): ConversationState {
    const existing = this.conversations.get(id);
    if (!existing) {
      throw new ConversationNotFoundError(id);
    }
    const fresh: ConversationState = {
      id,
      status: "gathering_preferences",
      messages: [],
      preferences: {},
      plan: null,
      createdAt: existing.createdAt,
      updatedAt: this.now().toISOString(),
    };
    this.conversations.set(id, fresh);
    return fresh;
  }
}
