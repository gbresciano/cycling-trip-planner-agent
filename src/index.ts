// Application entry point. Composes dependencies and starts the server.
//
// Wiring is intentionally explicit (no DI container): each module gets
// the deps it needs as constructor arguments, in one place. That keeps
// the dependency graph obvious and gives tests a clean seam — they can
// build the same graph with fakes substituted.

import { registerChatRoute } from "../api/chat.js";
import { createClaudeClient, createOrchestrator } from "../agent/index.js";
import { createDefaultRegistry } from "../tools/index.js";
import { ChatService } from "./chat-service.js";
import { env } from "./config.js";
import { InMemoryConversationStore } from "./conversation-store.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const app = buildServer();

  // /chat is only registered when we have an API key. The /health route
  // still boots so liveness probes work even in a half-configured env.
  if (env.CLAUDE_API_KEY) {
    const claude = createClaudeClient({ apiKey: env.CLAUDE_API_KEY });
    const registry = createDefaultRegistry();
    const orchestrator = createOrchestrator({ claude, registry });
    const store = new InMemoryConversationStore();
    const service = new ChatService(store, orchestrator);

    registerChatRoute(app, {
      service,
      includeDebug: env.NODE_ENV === "development",
    });
  } else {
    app.log.warn("CLAUDE_API_KEY not set; /chat route disabled");
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
