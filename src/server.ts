import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./config.js";

const chatHtml = readFileSync(resolve(process.cwd(), "chat.html"), "utf8");

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  app.get("/health", async () => ({ status: "ok" }));

  // serve chat UI for trying out the agent
  app.get("/", async (_request, reply) => {
    reply.type("text/html");
    return chatHtml;
  });

  return app;
}
