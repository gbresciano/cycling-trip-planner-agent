// Anthropic SDK boundary.
//
// Everything past this file (the orchestrator, the API layer, future UIs)
// imports only the wrapper types defined here and never touches
// `@anthropic-ai/sdk` directly. That isolation lets us upgrade across SDK
// breaking changes, swap models, or migrate to a different provider by
// editing just this file.

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Tool } from "../tools/types.js";

// Wrapper types mirror Anthropic's content-block structure (text /
// tool_use / tool_result) but use our naming conventions (`toolUseId` vs
// `tool_use_id`) and stay deliberately small — just the fields the agent
// loop actually consumes. Thinking and other block types are dropped on
// the way in.
export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ClaudeAssistantBlock = ClaudeTextBlock | ClaudeToolUseBlock;
export type ClaudeMessageBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock;

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeMessageBlock[];
}

export type ClaudeStopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal";

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ClaudeResponse {
  content: ClaudeAssistantBlock[];
  stopReason: ClaudeStopReason | null;
  usage: ClaudeUsage;
  model: string;
}

export interface ClaudeCompleteParams {
  system: string;
  messages: ClaudeMessage[];
  tools?: Tool[];
  model?: string;
  maxTokens?: number;
}

export interface ClaudeClient {
  complete(params: ClaudeCompleteParams): Promise<ClaudeResponse>;
}

export interface ClaudeClientConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

// Defaults chosen deliberately:
//   - Opus 4.7 is the most capable Anthropic model and supports the
//     adaptive-thinking surface this app uses.
//   - 16000 tokens stays under the SDK's non-streaming HTTP timeout
//     while leaving room for tool-heavy turns.
const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 16000;

export function createClaudeClient(config: ClaudeClientConfig): ClaudeClient {
  if (!config.apiKey) {
    throw new Error("createClaudeClient: apiKey is required");
  }

  const sdk = new Anthropic({ apiKey: config.apiKey });
  const defaultModel = config.model ?? DEFAULT_MODEL;
  const defaultMaxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async complete(params: ClaudeCompleteParams): Promise<ClaudeResponse> {
      const tools = params.tools?.map(toSdkTool);

      const response = await sdk.messages.create({
        model: params.model ?? defaultModel,
        max_tokens: params.maxTokens ?? defaultMaxTokens,
        // `cache_control: ephemeral` on the system block caches the
        // entire `tools + system` prefix (Anthropic renders them in that
        // order). The orchestrator sends a stable system prompt + tool
        // list every turn, so subsequent turns read from cache instead
        // of paying full input cost on the unchanged preamble.
        system: [
          {
            type: "text",
            text: params.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: params.messages.map(toSdkMessage),
        // Spread-only-when-present so we don't send an empty `tools: []`
        // (which would change the cache key vs the no-tools form).
        ...(tools && tools.length > 0 ? { tools } : {}),
        // Adaptive thinking lets the model decide *when* to reason
        // explicitly. Opus 4.7 only supports `adaptive` (the older
        // `enabled` + `budget_tokens` shape returns 400 on this model).
        thinking: { type: "adaptive" },
      });

      return fromSdkResponse(response);
    },
  };
}

// zod → JSON Schema for the API. Anthropic validates tool schemas against
// JSON Schema draft 2020-12; `target: "jsonSchema7"` is compatible because
// draft-7 emits `exclusiveMinimum`/`exclusiveMaximum` as numbers (same as
// 2020-12). The `openApi3` target emits them as booleans alongside a
// separate `minimum`, which 2020-12 rejects (breaks `z.number().positive()`
// etc.). `$refStrategy: "none"` inlines all $refs so every tool schema is
// self-contained — the API doesn't resolve refs across the tools array.
function toSdkTool(tool: Tool): Anthropic.Tool {
  const schema = zodToJsonSchema(tool.inputSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Anthropic.Tool.InputSchema;

  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema,
  };
}

function toSdkMessage(message: ClaudeMessage): Anthropic.MessageParam {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content.map(toSdkBlock),
  };
}

function toSdkBlock(block: ClaudeMessageBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError !== undefined ? { is_error: block.isError } : {}),
      };
  }
}

// Read direction. We deliberately drop thinking blocks (and any future
// block types the SDK adds) — the orchestrator only knows how to handle
// text and tool_use. Anything else is silently ignored rather than
// surfaced upstream.
function fromSdkResponse(response: Anthropic.Message): ClaudeResponse {
  const content: ClaudeAssistantBlock[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return {
    content,
    stopReason: response.stop_reason as ClaudeStopReason | null,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
