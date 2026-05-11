// POST /chat — thin route handler.
//
// Responsibilities, in order: zod-validate the body, delegate to
// `ChatService`, shape the JSON response. No business logic lives here;
// the route is replaceable (CLI, websocket, etc.) without rewriting the
// chat flow.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatService } from "../src/chat-service.js";
import { ConversationNotFoundError } from "../src/conversation-store.js";

const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatRouteOptions {
  service: ChatService;
  // When true, the response includes a `toolCalls` field with the tool
  // inputs and outputs from this turn. Useful for debugging in dev;
  // omitted in production so internal tool shapes don't leak.
  includeDebug: boolean;
}

export function registerChatRoute(
  app: FastifyInstance,
  opts: ChatRouteOptions,
): void {
  app.post("/chat", async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        error: "invalid_request",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    try {
      const result = await opts.service.chat(parsed.data);
      return {
        conversationId: result.conversationId,
        assistantMessage: result.assistantMessage,
        state: result.state,
        plan: result.plan,
        ...(opts.includeDebug ? { toolCalls: result.toolCalls } : {}),
      };
    } catch (err) {
      if (err instanceof ConversationNotFoundError) {
        reply.status(404);
        return {
          error: "conversation_not_found",
          conversationId: err.conversationId,
        };
      }
      // Anything else (Claude API error, tool runtime error) bubbles up
      // as a 500. We log the underlying error for ops; the client sees
      // a generic message.
      request.log.error({ err }, "chat handler failed");
      reply.status(500);
      return { error: "internal_error" };
    }
  });
}
