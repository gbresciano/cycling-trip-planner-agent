import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { registerChatRoute } from "../api/chat.js";
import {
  createOrchestrator,
  type ClaudeAssistantBlock,
  type ClaudeClient,
  type ClaudeResponse,
} from "../agent/index.js";
import { ChatService } from "../src/chat-service.js";
import { InMemoryConversationStore } from "../src/conversation-store.js";
import { buildServer } from "../src/server.js";
import { createDefaultRegistry } from "../tools/index.js";

function textResponse(text: string): ClaudeResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    model: "fake-model",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };
}

function toolUseResponse(
  calls: Array<{ id: string; name: string; input: unknown }>,
): ClaudeResponse {
  const content: ClaudeAssistantBlock[] = calls.map((c) => ({
    type: "tool_use",
    id: c.id,
    name: c.name,
    input: c.input,
  }));
  return {
    content,
    stopReason: "tool_use",
    model: "fake-model",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };
}

function fakeClaude(responses: ClaudeResponse[]): ClaudeClient {
  let i = 0;
  return {
    async complete() {
      const next = responses[i++];
      if (!next) throw new Error(`No canned response at ${i - 1}`);
      return next;
    },
  };
}

interface Harness {
  app: FastifyInstance;
}

async function buildHarness(
  responses: ClaudeResponse[],
  opts: { includeDebug?: boolean } = {},
): Promise<Harness> {
  const claude = fakeClaude(responses);
  const registry = createDefaultRegistry();
  const orchestrator = createOrchestrator({ claude, registry });
  const store = new InMemoryConversationStore();
  const service = new ChatService(store, orchestrator);
  const app = buildServer();
  registerChatRoute(app, {
    service,
    includeDebug: opts.includeDebug ?? false,
  });
  return { app };
}

describe("POST /chat", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("creates a conversation on first call and returns the assistant reply", async () => {
    ({ app } = await buildHarness([
      textResponse("Where would you like to start and end the trip?"),
    ]));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "I want a cycling trip in the Alps." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.assistantMessage).toMatch(/start and end/i);
    expect(body.plan).toBeNull();
    expect(body.state.status).toBe("needs_clarification");
    expect(body.toolCalls).toBeUndefined();
  });

  it("continues an existing conversation when conversationId is provided", async () => {
    ({ app } = await buildHarness([
      textResponse("Where would you like to start?"),
      textResponse("Got it — checking routes."),
    ]));

    const first = (
      await app.inject({
        method: "POST",
        url: "/chat",
        payload: { message: "Plan me a trip." },
      })
    ).json();

    const second = await app.inject({
      method: "POST",
      url: "/chat",
      payload: {
        conversationId: first.conversationId,
        message: "Chamonix to Geneva, 3 days.",
      },
    });

    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.conversationId).toBe(first.conversationId);
    expect(body.state.messages.length).toBeGreaterThan(
      first.state.messages.length,
    );
  });

  it("returns 404 for an unknown conversationId", async () => {
    ({ app } = await buildHarness([textResponse("hi")]));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: {
        conversationId: "11111111-1111-1111-1111-111111111111",
        message: "hi",
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("conversation_not_found");
  });

  it("returns 400 on invalid body (zod)", async () => {
    ({ app } = await buildHarness([textResponse("hi")]));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "" },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.details.message).toBeDefined();
  });

  it("includes toolCalls debug payload when includeDebug=true", async () => {
    ({ app } = await buildHarness(
      [
        toolUseResponse([
          {
            id: "tu_1",
            name: "get_weather",
            input: {
              location: { latitude: 45.92, longitude: 6.87 },
              date: "2026-06-15",
            },
          },
        ]),
        textResponse("Looks sunny."),
      ],
      { includeDebug: true },
    ));

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "Weather in Chamonix on June 15, 2026?" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.toolCalls)).toBe(true);
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolCalls[0].name).toBe("get_weather");
    expect(body.toolCalls[0].output).toMatchObject({ conditions: expect.any(String) });
  });
});
