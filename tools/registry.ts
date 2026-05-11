// The registry stores tools heterogeneously (different input/output
// types per tool) but exposes them through a single string-keyed API.
// That requires type erasure at the storage boundary.
//
// `register` stays generic so the *caller* keeps the tool's precise
// type at the call site (useful for direct `.execute()` invocations);
// we only erase to `Tool` when storing. The `as unknown as Tool` cast
// is the deliberate seam between the strongly-typed call site and the
// dynamic, name-keyed storage.

import type { z } from "zod";
import type { Tool } from "./types.js";

export class ToolNotFoundError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool '${toolName}' is not registered`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register<TSchema extends z.ZodTypeAny, TOutput>(
    tool: Tool<TSchema, TOutput>,
  ): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool as unknown as Tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  // Runtime contract: parse with the tool's zod schema before executing.
  // The LLM hands us unvalidated JSON; we never pass it straight to
  // execute. On failure zod throws — the orchestrator catches and
  // surfaces it as an `isError: true` tool_result so the agent can retry.
  async invoke(name: string, rawInput: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    const parsed = tool.inputSchema.parse(rawInput);
    return tool.execute(parsed);
  }
}
