// The shared tool contract. Every tool — mock data tools, the agent's
// submit_trip_plan tool, anything added later — implements `Tool`.
//
// `inputSchema` is a zod schema; `execute` receives the *inferred* type
// of that schema via `z.infer<TSchema>`. Define the schema once and the
// execute function is typed automatically — no second source of truth.

import type { z } from "zod";

export interface Tool<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<TOutput>;
}

// `defineTool` is an identity function — it returns its argument
// unchanged. Its only job is to let TypeScript *infer* the generic
// parameters (TSchema from the literal schema, TOutput from the execute
// return type) when you pass an object literal. Without this helper,
// callers would have to annotate generics by hand and lose inference.
export function defineTool<TSchema extends z.ZodTypeAny, TOutput>(
  tool: Tool<TSchema, TOutput>,
): Tool<TSchema, TOutput> {
  return tool;
}
