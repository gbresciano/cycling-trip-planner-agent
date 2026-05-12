# Cycling Trip Planner Agent

AI cycling trip planner built around an explicit agent orchestration loop. Claude gathers preferences from the user, calls research tools (route, elevation, weather, accommodation), and commits a structured day-by-day plan via a dedicated submission tool. Exposed over Fastify as `POST /chat`.

**Stack:** TypeScript (strict, NodeNext), Node 20+, Fastify 5, Zod 3, `@anthropic-ai/sdk`, Vitest. No framework abstractions on top of the agent loop — the orchestration is plain control flow.

---

## Setup

```bash
npm install
cp .env.example .env   # set CLAUDE_API_KEY
npm run dev
```

```bash
curl localhost:3000/health

curl -X POST localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "Plan a 4-day cycling trip from Chamonix to Geneva starting 2026-06-15"}'
```

You can also go to on your browser `localhost:3000/` and use the UI to chat

Without `CLAUDE_API_KEY` the server still boots (the healthcheck works) but `/chat` is not registered. Set `NODE_ENV=development` to include the `toolCalls` debug payload in chat responses.

| Script              |                             |
| ------------------- | --------------------------- |
| `npm run dev`       | tsx watch on `src/index.ts` |
| `npm run build`     | tsc to `dist/`              |
| `npm test`          | vitest run (51 tests)       |
| `npm run typecheck` | tsc --noEmit                |

## Layout

```
agent/         orchestrator, Claude SDK boundary, submit_trip_plan tool, system prompt
api/           Fastify route(s)
src/           env config, server, in-memory store, chat service
src/domain/    TS-only domain (trip, conversation, preferences)
tools/         shared Tool interface, registry, mock tools, runtime schemas
tests/         vitest
```

---

## Workflow

```
                          ┌──────────────────────┐
                          │  Client (browser /   │
                          │  curl)               │
                          └──────────┬───────────┘
                                     │  POST /chat { message }
                                     ▼
                          ┌──────────────────────┐
                          │  Fastify route       │
                          │  api/chat.ts         │
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐        ┌───────────────────────────┐
                          │  ChatService         │◄──────►│  InMemoryConversationStore │
                          │  src/chat-service.ts │ get /  │  (ConversationState:       │
                          └──────────┬───────────┘ update │   messages, preferences,   │
                                     │                    │   plan, status)            │
                                     ▼                    └───────────────────────────┘
                          ┌──────────────────────┐
                          │  Orchestrator        │  append user message → state
                          │  agent/orchestrator  │
                          └──────────┬───────────┘
                                     ▼
   ┌─────────────────────────  AGENT LOOP  (≤ maxIterations, default 12)  ──────────────────────────┐
   │                                                                                                │
   │     ┌──────────────────────────────────────────┐                                               │
   │     │  claude.complete(                        │                                               │
   │     │     system + tools  ← cached prefix      │                                               │
   │     │     full message history ← new tail      │                                               │
   │     │  )           agent/claude.ts             │                                               │
   │     └──────────────────────┬───────────────────┘                                               │
   │                            │ assistant: text + tool_use blocks                                 │
   │                            ▼                                                                   │
   │              append assistant message → state                                                  │
   │                            │                                                                   │
   │                            ▼                                                                   │
   │                  ╱╲  any tool_use blocks?                                                      │
   │                 ╱  ╲ ─── no (end_turn) ────────────────────────► EXIT LOOP                     │
   │                 ╲  ╱                                                                           │
   │                  ╲╱                                                                            │
   │                   │ yes                                                                        │
   │                   ▼                                                                            │
   │     ┌──────────────────────────────────────────────────────────────────────────────────┐       │
   │     │  Promise.all( tool_uses.map(execute) )    ← in parallel, order preserved         │       │
   │     │                                                                                  │       │
   │     │   ┌──── research tools ────┐  ┌── submit_trip_plan ──┐ ┌── update_preferences ─┐ │       │
   │     │   │  get_route             │  │  zod-validates       │ │  applyPreferenceUpdate│ │       │
   │     │   │  get_weather           │  │  recomputes totals   │ │  may wipe state.plan  │ │       │
   │     │   │  get_elevation_profile │  │  → TripPlan          │ │  → re-plan next iter  │ │       │
   │     │   │  find_accommodation    │  └──────────────────────┘ └───────────────────────┘ │       │
   │     │   └────────────────────────┘                                                     │       │
   │     │                                                                                  │       │
   │     │   failures → tool_result { isError: true }   (agent typically retries)           │       │
   │     └────────────────────────────────────┬─────────────────────────────────────────────┘       │
   │                                          ▼                                                     │
   │             append ALL tool_results in ONE user message → state                                │
   │                                          │                                                     │
   │                                          └──────────────► next iteration ──────────┐           │
   │                                                                                    │           │
   └────────────────────────────────────────────────────────────────────────────────────┼───────────┘
                                                                                        │
                                                  ┌─────────────────────────────────────┘
                                                  ▼
                                     status: ready (plan set) │ needs_clarification (no plan)
                                                  │
                                                  ▼
                                     persist ConversationState → store
                                                  │
                                                  ▼
                                     return { state, reply, plan } ──► Client
```

`stop_reason: end_turn` (no `tool_use` blocks) is the loop's exit signal — the same code path handles clarification questions and post-submission recaps. `submit_trip_plan` and `update_preferences` are ordinary tools the orchestrator inspects by name to pull structured signals (the validated plan, the preference patch) out of the result.

---

## Architecture decisions

- **Explicit orchestration loop.** No LangChain, no agent framework. A single `for` loop in `agent/orchestrator.ts` reads as procedural code; every branch is visible.
- **SDK isolation.** All Anthropic SDK usage lives in `agent/claude.ts`. The rest of the codebase only imports our wrapper types — swapping providers or upgrading across SDK breaking changes touches one file.
- **Domain types vs runtime schemas, kept separate.** `src/domain/` is pure TypeScript: zero runtime dependencies. Zod schemas live next to their consumers (`tools/schemas.ts`, `agent/plan-schemas.ts`) and act as runtime guards at untrusted boundaries (env, HTTP, LLM output).
- **Zod at every untrusted edge.** Environment, request bodies, tool inputs, and the agent's plan submission all parse through zod before being trusted.
- **In-memory store behind a `ConversationStore` interface.** Adequate for the demo; swappable for Redis/Postgres without touching consumers.
- **Deterministic mock tools.** Each mock seeds a Park-Miller LCG with an FNV-1a hash of its input. Same input → same output, every time — assertive tests, valid prompt caching, tractable debugging.
- **Prompt caching on every turn.** `cache_control: ephemeral` on the system block caches the `tools + system` prefix, so long conversations only pay full input cost on the new tail.
- **Adaptive thinking + Opus 4.7.** Defaults in `agent/claude.ts`. Opus 4.7 only supports `thinking: {type: "adaptive"}`; the wrapper sets it unconditionally.

---

## How the orchestration works

`agent/orchestrator.ts`, function `runTurn`:

```
append user message → state
loop up to maxIterations (default 12):
  response = claude.complete(system, full message history, tools)
  append assistant response → state
  if response has no tool_use blocks:
    return                        # agent asked a clarification or wrote a recap
  execute every tool_use in parallel → tool_result
  append all tool_results in one user message
```

Decisions worth calling out:

- **`stop_reason: end_turn` is the loop's exit signal**, not a separate "I'm done" flag. The agent uses the same code path for clarification questions and post-submission recaps.
- **Tool results are batched into one user message per turn.** Anthropic's protocol requires it.
- **Tool calls within a turn run in parallel** via `Promise.all`. When the agent batches independent research calls (route + weather + accommodation) in a single assistant message, they fire concurrently instead of serially — a meaningful latency win once tools hit real network APIs. Block order in the `tool_result` user message is preserved so state-mutating effects (plan/preference updates) apply in the order the agent emitted them.
- **`submit_trip_plan` is a tool, not a special API.** The orchestrator special-cases its `name` to re-validate the input with zod and build the canonical `TripPlan` with recomputed totals — never trusting the agent's own arithmetic. Returns a synthetic success result so the agent can write its confirmation on the next iteration.
- **Tool failures don't crash the turn.** Zod validation errors and runtime throws become `tool_result` blocks with `isError: true`. The agent typically retries with corrected input.
- **`maxIterations` is a safety net** for a misbehaving prompt — not the expected termination condition.

The full agent trace (text + tool_use + tool_result blocks) lives in `state.messages` and is sent back to Claude on every turn. Combined with prompt caching, this gives the agent durable memory of its own research without a separate scratchpad.

---

## Tool system design

Every tool implements one interface (`tools/types.ts`):

```ts
interface Tool<TSchema extends z.ZodTypeAny, TOutput> {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<TOutput>;
}
```

A `defineTool()` identity-function helper lets TypeScript infer `TSchema` and `TOutput` from an object literal — no manual generic annotations at the call site.

The `ToolRegistry` stores tools heterogeneously and exposes them by name. Storage type-erases to `Tool` at one explicit `as unknown as Tool` seam; `register` stays generic so call-site types are preserved. `invoke(name, rawInput)` runs the zod schema before executing — the LLM's JSON is never trusted as-is.

The four mock data tools (`get_route`, `find_accommodation`, `get_weather`, `get_elevation_profile`) and the agent's `submit_trip_plan` tool all share this contract. Adding a new tool is one file under `tools/` plus one line in `createDefaultRegistry()`. Tool schemas are converted to JSON Schema for the API via `zod-to-json-schema` inside `agent/claude.ts`.

---

## Conversation state design

```ts
interface ConversationState {
  id: string;
  status: ConversationStatus;
  messages: ConversationMessage[]; // raw history (text + tool blocks)
  preferences: Partial<TripPreferences>; // extracted user inputs
  plan: TripPlan | null; // derived planning data
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

The three concerns the spec separates — raw chat, extracted preferences, derived planning data — are three independent fields. They can be read or replaced without touching the others.

`ConversationMessage.content` is a discriminated union over `text | tool_use | tool_result` blocks that mirrors Anthropic's content-block shape. This is deliberate: the full agent trace is replayable. Each turn sends the entire history back to the API (cached at the prefix), and no parallel "tool log" has to be reconstructed.

State updates are immutable — every turn returns a new `ConversationState`. The `InMemoryConversationStore` is the only place that holds long-lived state; the chat handler is just `get → orchestrate → update`. `update` and `reset` throw on unknown ids — silently upserting would hide client bugs.

---

## Partial replanning

`src/domain/preferences.ts` exposes three pure functions:

- **`mergePreferences(current, updates)`** — last-write-wins merge; `undefined` doesn't overwrite existing values, so callers can pass narrow patches.
- **`preferencesInvalidatePlan(before, after)`** — true iff a _plan-relevant_ field actually changed value. Plan-relevant: `startLocation`, `endLocation`, `startDate`, `durationDays`, `minDailyKm`, `maxDailyKm`, `fitnessLevel`, `terrain`, `accommodationTypes`, `budgetPerDay`. Cosmetic fields (`notes`, `mustVisit`) don't invalidate.
- **`applyPreferenceUpdate(state, updates, now?)`** — merges and, if (and only if) a plan exists and the change invalidates it, wipes the plan, flips status to `planning`, and bumps `updatedAt`.

Today the orchestrator implicitly invalidates by overwriting `state.plan` when the agent calls `submit_trip_plan` again with revised data. The pure utility is ready to plug into an explicit `update_preferences` tool — a step where the agent updates preferences without immediately replanning — without changing the loop.

---

## Tradeoffs

- **In-memory store.** Single process, lost on restart. Trivially swappable behind `ConversationStore`. Picked for interview clarity.
- **No streaming.** `POST /chat` is request/response. Adequate for short flows; a real chat UI wants SSE/WebSocket.
- **Submit-plan input is verbose.** The agent re-passes tool outputs into the submission. The alternative — tracking tool outputs in orchestrator state and indexing from the submit payload — is more clever but harder to follow.
- **Mock tools.** Realistic shapes and deterministic, but no real geographic data.
- **The full `ConversationState` is returned on every chat call.** Useful for debugging, wasteful in production (`messages` can include large elevation point arrays). Would project to a view model behind a flag.
- **No auth, no per-user isolation.** A single shared store. Production needs scoped stores keyed by user.

---

## What I would improve with more time

- **Streaming responses** end-to-end (Claude `messages.stream()` → orchestrator yields → SSE to client).
- **Real tools** — Mapbox/OSRM for routes, Open-Meteo for weather, a real accommodation provider. The `Tool` interface doesn't change.
- **Explicit `update_preferences` tool** that calls `applyPreferenceUpdate`, making partial replanning a first-class step instead of an implicit overwrite at submit time.
- **Persistent storage** — Postgres + a JSONB column for `ConversationState`, behind the existing `ConversationStore` interface.
- **Per-user auth** and conversation isolation; surface `stop_reason: "refusal"` to the client with a useful message.
- **Token budget enforcement** via Anthropic's `task_budget` (beta) to bound spend per agent run.
- **History compaction** — once `state.messages` crosses a token threshold, summarize older turns (tool calls + results especially) into a single assistant note and keep recent turns verbatim. Preserves the cached prefix while bounding input cost on long conversations.
- **External memory / notes tool** — a `remember` / `recall` tool the agent writes durable facts to ("user prefers gravel, avoids highways, dislikes hostels"). Targeted retrieval beats resending full history, and survives compaction.
- **Consolidated zod schemas** — `tools/schemas.ts` and `agent/plan-schemas.ts` both define `GeoPoint`/`IsoDate`. One shared module.
- **One opt-in smoke test** against the real Anthropic API to catch SDK regressions on upgrades; all 51 tests today use a fake client.
