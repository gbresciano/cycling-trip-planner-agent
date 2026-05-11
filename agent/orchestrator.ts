// The agent orchestration loop.
//
// Flow per `sendMessage(state, userInput)`:
//   1. Append the user's text to state.
//   2. Loop:
//      a. Send the full message history (text + tool blocks) to Claude.
//      b. Append the assistant's response to state.
//      c. If the response has no tool_use blocks, return — the agent
//         is either asking a clarification or wrapping up.
//      d. Otherwise execute each tool, return all results in a single
//         user message, and continue.
//   3. Bail at `maxIterations` so a misbehaving prompt can't loop forever.
//
// Everything is explicit on purpose — no framework, no implicit state.
// `ConversationState` is the single source of truth and the only thing
// the caller threads across turns.

import { randomUUID } from "node:crypto";
import {
  applyPreferenceUpdate,
  createEmptyConversation,
  type ConversationContent,
  type ConversationMessage,
  type ConversationState,
  type IsoDateTime,
  type TripPlan,
  type TripPreferences,
} from "../src/domain/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ClaudeAssistantBlock, ClaudeClient, ClaudeMessage, ClaudeMessageBlock, ClaudeToolUseBlock } from "./claude.js";
import type { SubmitTripPlanInput } from "./plan-schemas.js";
import { SUBMIT_TRIP_PLAN_TOOL_NAME, submitTripPlanTool } from "./submit-plan-tool.js";
import { UPDATE_PREFERENCES_TOOL_NAME, updatePreferencesTool } from "./update-preferences-tool.js";
import { TRIP_PLANNER_SYSTEM_PROMPT } from "./system-prompt.js";

// Dependencies are injected so the orchestrator stays testable. The fake
// `ClaudeClient` in `tests/orchestrator.test.ts` is just an object that
// returns canned responses; the real client (or a different LLM) drops in
// without changing this file. `now` is overridable to keep timestamps
// deterministic in tests.
export interface OrchestratorDeps {
  claude: ClaudeClient;
  registry: ToolRegistry;
  systemPrompt?: string;
  maxIterations?: number;
  now?: () => Date;
}

export interface TurnResult {
  state: ConversationState;
  reply: string;
  plan: TripPlan | null;
}

export interface Orchestrator {
  newConversation(): ConversationState;
  sendMessage(state: ConversationState, userInput: string): Promise<TurnResult>;
}

const DEFAULT_MAX_ITERATIONS = 12;

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const systemPrompt = deps.systemPrompt ?? TRIP_PLANNER_SYSTEM_PROMPT;
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const now = deps.now ?? (() => new Date());

  // The two places the orchestrator couples itself to specific tools:
  // `submit_trip_plan` is how the agent commits a final plan, and
  // `update_preferences` is how it records preferences incrementally so
  // we can detect plan-invalidating changes mid-conversation. Both are
  // registered idempotently so multiple orchestrators sharing a registry
  // don't collide.
  if (!deps.registry.has(SUBMIT_TRIP_PLAN_TOOL_NAME)) {
    deps.registry.register(submitTripPlanTool);
  }
  if (!deps.registry.has(UPDATE_PREFERENCES_TOOL_NAME)) {
    deps.registry.register(updatePreferencesTool);
  }

  return {
    newConversation: () => createEmptyConversation(now),
    sendMessage: (state, userInput) =>
      runTurn(state, userInput, deps, {
        systemPrompt,
        maxIterations,
        now,
      }),
  };
}

interface RunOptions {
  systemPrompt: string;
  maxIterations: number;
  now: () => Date;
}

// One agentic turn from the user's perspective: one inbound message, one
// final reply. Internally this can be many Claude round trips — one per
// batch of tool calls the agent makes.
async function runTurn(state: ConversationState, userInput: string, deps: OrchestratorDeps, opts: RunOptions): Promise<TurnResult> {
  // State updates are always immutable copies (see `appendMessage`). The
  // `working` variable is the rolling state for this turn; we return it
  // at the end so the caller can persist it.
  let working: ConversationState = appendMessage(state, makeMessage("user", [{ type: "text", text: userInput }], opts.now()), {
    status: "planning",
    now: opts.now,
  });

  let plan: TripPlan | null = state.plan;
  let reply = "";

  // This for-loop *is* the agent loop. Each iteration is one Claude
  // request + one batch of tool executions. The cap is a safety net,
  // not the expected termination condition (`end_turn` is).
  for (let i = 0; i < opts.maxIterations; i++) {
    // We send the entire message history (including prior tool_use and
    // tool_result blocks) on every turn. That's what gives the agent
    // memory of what it has already researched within this conversation.
    // Prompt caching makes this cheap: the system + tools prefix is
    // cached, so each subsequent turn only pays input cost on the new
    // tail of messages.
    const response = await deps.claude.complete({
      system: opts.systemPrompt,
      messages: toClaudeMessages(working.messages),
      tools: deps.registry.list(),
    });

    const assistantContent = assistantBlocksToContent(response.content);
    working = appendMessage(working, makeMessage("assistant", assistantContent, opts.now()), { now: opts.now });

    const textParts = assistantContent
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map(c => c.text)
      .filter(t => t.length > 0);
    if (textParts.length > 0) {
      reply = textParts.join("\n\n");
    }

    const toolUses = response.content.filter((b): b is ClaudeToolUseBlock => b.type === "tool_use");

    // Terminal exit for this turn. The agent either asked the user a
    // question (no plan yet → needs_clarification) or wrote a recap
    // after submitting the plan (plan set → ready). Both paths look
    // the same to the loop: no more tools to run, hand control back.
    if (toolUses.length === 0) {
      working = {
        ...working,
        status: plan ? "ready" : "needs_clarification",
        updatedAt: opts.now().toISOString(),
      };
      return { state: working, reply, plan };
    }

    // Anthropic's protocol requires that all `tool_result` blocks for
    // the tool_uses in one assistant turn arrive together in a single
    // subsequent user message. We accumulate them, then append once
    // below — never one user message per tool.
    const toolResults: ConversationContent[] = [];
    for (const use of toolUses) {
      const result = await executeToolCall(use, deps.registry);

      toolResults.push(result.content);
      if (result.plan) {
        plan = result.plan;
      }
      if (result.preferencePatch) {
        // Folding the patch through `applyPreferenceUpdate` (rather than
        // a plain merge) is the whole point: if an invalidating field
        // changed, the existing plan gets wiped here so the agent sees
        // `state.plan === null` on the next iteration and re-plans.
        const previousPlan = working.plan;
        working = applyPreferenceUpdate(working, result.preferencePatch, opts.now);
        // Only clear the local `plan` if a previously-saved plan was
        // actually invalidated. We can't just sync `plan = working.plan`
        // unconditionally: a `submit_trip_plan` in the same batch sets
        // the local `plan` here, but `working.plan` is still null at
        // this point (it's written by `appendMessage` below), so a blind
        // sync would clobber the brand-new plan.
        if (previousPlan !== null && working.plan === null) {
          plan = null;
        }
      }
    }

    working = appendMessage(working, makeMessage("user", toolResults, opts.now()), {
      plan,
      status: plan ? "ready" : "planning",
      now: opts.now,
    });
  }

  return {
    state: { ...working, status: "error", updatedAt: opts.now().toISOString() },
    reply: reply || "Reached the maximum number of agent iterations.",
    plan,
  };
}

interface ToolCallResult {
  content: ConversationContent;
  plan: TripPlan | null;
  preferencePatch: Partial<TripPreferences> | null;
}

// Tool dispatch.
//
// Two tools are special — they carry signals back to the orchestrator
// beyond the textual `tool_result`:
//   - `submit_trip_plan` signals "I'm done — here is the structured
//     plan." We also surface its `preferences` so state.preferences
//     reflects what the agent committed.
//   - `update_preferences` carries a partial patch that runTurn folds
//     through `applyPreferenceUpdate`, which may invalidate the plan.
// Both go through their zod schema here as defense in depth (the
// registry would parse too, but we'd lose the typed result).
//
// Tool failures (zod validation, runtime errors) are caught and surfaced
// as `tool_result` blocks with `isError: true` rather than thrown. This
// lets the agent see the error, reason about it, and typically retry
// with corrected input — far better UX than crashing the entire turn.
async function executeToolCall(use: ClaudeToolUseBlock, registry: ToolRegistry): Promise<ToolCallResult> {
  try {
    if (use.name === SUBMIT_TRIP_PLAN_TOOL_NAME) {
      const parsed = submitTripPlanTool.inputSchema.parse(use.input);
      const plan = buildTripPlan(parsed);
      return {
        content: {
          type: "tool_result",
          toolUseId: use.id,
          output: "Trip plan submitted successfully.",
        },
        plan,
        preferencePatch: parsed.preferences,
      };
    }
    if (use.name === UPDATE_PREFERENCES_TOOL_NAME) {
      const patch = updatePreferencesTool.inputSchema.parse(use.input);
      return {
        content: {
          type: "tool_result",
          toolUseId: use.id,
          output: "Preferences updated.",
        },
        plan: null,
        preferencePatch: patch,
      };
    }
    const output = await registry.invoke(use.name, use.input);
    return {
      content: {
        type: "tool_result",
        toolUseId: use.id,
        // Tool outputs are JSON-stringified because Anthropic's
        // tool_result content is always a string. The model parses it
        // back when needed.
        output: JSON.stringify(output),
      },
      plan: null,
      preferencePatch: null,
    };
  } catch (err) {
    return {
      content: {
        type: "tool_result",
        toolUseId: use.id,
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      },
      plan: null,
      preferencePatch: null,
    };
  }
}

// Totals are computed here, not taken from the agent's input. Per-segment
// numbers come from real tool outputs; summing them ourselves means the
// plan can't disagree with its own parts (a subtle hallucination class).
function buildTripPlan(input: SubmitTripPlanInput): TripPlan {
  const totalDistanceKm = input.segments.reduce((sum, s) => sum + s.route.distanceKm, 0);
  const totalElevationGainM = input.segments.reduce((sum, s) => sum + s.route.elevation.totalGainM, 0);
  return {
    id: randomUUID(),
    preferences: input.preferences,
    summary: input.summary,
    segments: input.segments,
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    totalElevationGainM: Math.round(totalElevationGainM),
    generatedAt: new Date().toISOString(),
  };
}

function makeMessage(role: "user" | "assistant", content: ConversationContent[], now: Date): ConversationMessage {
  return {
    id: randomUUID(),
    role,
    content,
    createdAt: now.toISOString(),
  };
}

interface AppendOptions {
  status?: ConversationState["status"];
  plan?: TripPlan | null;
  now: () => Date;
}

function appendMessage(state: ConversationState, message: ConversationMessage, opts: AppendOptions): ConversationState {
  const updatedAt: IsoDateTime = opts.now().toISOString();
  return {
    ...state,
    messages: [...state.messages, message],
    status: opts.status ?? state.status,
    plan: opts.plan !== undefined ? opts.plan : state.plan,
    updatedAt,
  };
}

// Domain → SDK direction. Translating here (rather than storing
// Claude-shaped messages in state directly) keeps `src/domain/` free of
// any Anthropic-specific naming and lets us swap providers by editing
// only `agent/claude.ts` + this function.
function toClaudeMessages(messages: ConversationMessage[]): ClaudeMessage[] {
  return messages.map(m => ({
    role: m.role,
    content: m.content.map(toClaudeBlock),
  }));
}

function toClaudeBlock(c: ConversationContent): ClaudeMessageBlock {
  switch (c.type) {
    case "text":
      return { type: "text", text: c.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: c.toolUseId,
        name: c.toolName,
        input: c.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: c.toolUseId,
        content: c.output,
        ...(c.isError !== undefined ? { isError: c.isError } : {}),
      };
  }
}

function assistantBlocksToContent(blocks: ClaudeAssistantBlock[]): ConversationContent[] {
  return blocks.map((b): ConversationContent => {
    if (b.type === "text") {
      return { type: "text", text: b.text };
    }
    return {
      type: "tool_use",
      toolUseId: b.id,
      toolName: b.name,
      input: b.input,
    };
  });
}
