// Environment is loaded and validated once at boot. Failing fast here
// means the server never starts with bad config — far better than
// discovering a missing API key 5 minutes into the first agent run.

import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Required by `createClaudeClient`, optional here so the rest of the
  // app (server boot, healthcheck, unit tests) can run without it.
  CLAUDE_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
