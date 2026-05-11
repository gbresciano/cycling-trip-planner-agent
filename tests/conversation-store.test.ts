import { describe, expect, it } from "vitest";
import {
  ConversationNotFoundError,
  InMemoryConversationStore,
} from "../src/conversation-store.js";
import type { ConversationMessage } from "../src/domain/index.js";

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

describe("InMemoryConversationStore", () => {
  it("creates conversations with unique ids and empty state", () => {
    const store = new InMemoryConversationStore(fixedClock("2026-05-11T12:00:00Z"));

    const a = store.create();
    const b = store.create();

    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.preferences).toEqual({});
    expect(a.plan).toBeNull();
    expect(a.status).toBe("gathering_preferences");
    expect(a.createdAt).toBe("2026-05-11T12:00:00.000Z");
  });

  it("get returns saved state and undefined for unknown ids", () => {
    const store = new InMemoryConversationStore();
    const created = store.create();
    expect(store.get(created.id)).toEqual(created);
    expect(store.get("does-not-exist")).toBeUndefined();
  });

  it("update persists the new state", () => {
    const store = new InMemoryConversationStore();
    const created = store.create();

    const message: ConversationMessage = {
      id: "msg-1",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      createdAt: "2026-05-11T12:01:00.000Z",
    };
    const next = {
      ...created,
      messages: [message],
      status: "planning" as const,
      updatedAt: "2026-05-11T12:01:00.000Z",
    };

    const saved = store.update(next);
    expect(saved).toEqual(next);
    expect(store.get(created.id)).toEqual(next);
  });

  it("update throws ConversationNotFoundError for unknown ids", () => {
    const store = new InMemoryConversationStore();
    const stranger = {
      ...store.create(),
      id: "not-registered",
    };
    expect(() => store.update(stranger)).toThrow(ConversationNotFoundError);
  });

  it("reset wipes messages/preferences/plan but preserves id and createdAt", () => {
    const store = new InMemoryConversationStore(fixedClock("2026-05-11T12:00:00Z"));
    const created = store.create();

    store.update({
      ...created,
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: [{ type: "text", text: "Plan a trip" }],
          createdAt: "2026-05-11T12:01:00.000Z",
        },
      ],
      preferences: { durationDays: 5 },
      status: "planning",
    });

    const reset = store.reset(created.id);
    expect(reset.id).toBe(created.id);
    expect(reset.createdAt).toBe(created.createdAt);
    expect(reset.messages).toEqual([]);
    expect(reset.preferences).toEqual({});
    expect(reset.plan).toBeNull();
    expect(reset.status).toBe("gathering_preferences");
  });

  it("reset throws for unknown ids", () => {
    const store = new InMemoryConversationStore();
    expect(() => store.reset("nope")).toThrow(ConversationNotFoundError);
  });

  it("isolates conversations from each other", () => {
    const store = new InMemoryConversationStore();
    const a = store.create();
    const b = store.create();

    store.update({
      ...a,
      preferences: { fitnessLevel: "advanced" },
    });

    expect(store.get(a.id)?.preferences).toEqual({ fitnessLevel: "advanced" });
    expect(store.get(b.id)?.preferences).toEqual({});
  });
});
