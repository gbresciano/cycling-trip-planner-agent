import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrchestrator,
  type ClaudeAssistantBlock,
  type ClaudeClient,
  type ClaudeResponse,
} from "../agent/index.js";
import type { SubmitTripPlanInput } from "../agent/index.js";
import { createDefaultRegistry } from "../tools/index.js";

function fakeClient(responses: ClaudeResponse[]): {
  client: ClaudeClient;
  calls: Parameters<ClaudeClient["complete"]>[0][];
} {
  const calls: Parameters<ClaudeClient["complete"]>[0][] = [];
  let i = 0;
  return {
    calls,
    client: {
      async complete(params) {
        calls.push(params);
        const next = responses[i++];
        if (!next) throw new Error(`No canned response at index ${i - 1}`);
        return next;
      },
    },
  };
}

function textResponse(
  text: string,
  stopReason: ClaudeResponse["stopReason"] = "end_turn",
): ClaudeResponse {
  return {
    content: [{ type: "text", text }],
    stopReason,
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
  text?: string,
): ClaudeResponse {
  const content: ClaudeAssistantBlock[] = [];
  if (text) content.push({ type: "text", text });
  for (const c of calls) {
    content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
  }
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

const SAMPLE_PLAN: SubmitTripPlanInput = {
  preferences: {
    startLocation: { latitude: 45.92, longitude: 6.87, name: "Chamonix" },
    endLocation: { latitude: 46.2, longitude: 6.14, name: "Geneva" },
    startDate: "2026-06-15",
    durationDays: 1,
    minDailyKm: 60,
    maxDailyKm: 100,
    fitnessLevel: "intermediate",
    terrain: "mountainous",
    accommodationTypes: ["hotel"],
  },
  summary:
    "A scenic one-day ride from Chamonix to Geneva through alpine valleys with a finish along Lake Geneva.",
  segments: [
    {
      day: 1,
      date: "2026-06-15",
      start: { latitude: 45.92, longitude: 6.87, name: "Chamonix" },
      end: { latitude: 46.2, longitude: 6.14, name: "Geneva" },
      route: {
        distanceKm: 95,
        estimatedDurationHours: 5,
        elevation: {
          totalGainM: 600,
          totalLossM: 1500,
          maxElevationM: 1100,
          minElevationM: 370,
          points: [
            { distanceKm: 0, elevationM: 1035 },
            { distanceKm: 95, elevationM: 372 },
          ],
        },
        waypoints: [
          { latitude: 45.92, longitude: 6.87 },
          { latitude: 46.2, longitude: 6.14 },
        ],
        surface: "paved",
        difficulty: "moderate",
      },
      weather: {
        date: "2026-06-15",
        conditions: "sunny",
        temperatureMinC: 14,
        temperatureMaxC: 24,
        precipitationMm: 0,
        windSpeedKph: 10,
      },
      accommodation: {
        name: "Hotel Geneva Central",
        type: "hotel",
        location: { latitude: 46.2, longitude: 6.14 },
        pricePerNight: { amount: 140, currency: "EUR" },
        rating: 4.2,
      },
    },
  ],
};

describe("orchestrator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks a clarification when info is missing, then plans on the next turn", async () => {
    const responses: ClaudeResponse[] = [
      textResponse("Where would you like to start and end the trip?"),
      toolUseResponse(
        [
          {
            id: "tu_1",
            name: "get_weather",
            input: {
              location: { latitude: 45.92, longitude: 6.87 },
              date: "2026-06-15",
            },
          },
        ],
        "Let me check the weather.",
      ),
      toolUseResponse([
        { id: "tu_2", name: "submit_trip_plan", input: SAMPLE_PLAN },
      ]),
      textResponse(
        "Your one-day Chamonix-to-Geneva trip is booked. Enjoy the ride!",
      ),
    ];

    const { client, calls } = fakeClient(responses);
    const registry = createDefaultRegistry();
    const orchestrator = createOrchestrator({ claude: client, registry });

    let state = orchestrator.newConversation();
    expect(state.status).toBe("gathering_preferences");

    const turn1 = await orchestrator.sendMessage(
      state,
      "I'd like a one-day cycling trip in the Alps on June 15, 2026.",
    );
    state = turn1.state;

    expect(turn1.plan).toBeNull();
    expect(state.status).toBe("needs_clarification");
    expect(turn1.reply).toMatch(/start and end/i);
    expect(calls).toHaveLength(1);

    const turn2 = await orchestrator.sendMessage(
      state,
      "Chamonix to Geneva, intermediate fitness, 60-100 km, mountainous, hotel.",
    );
    state = turn2.state;

    expect(turn2.plan).not.toBeNull();
    expect(state.plan).not.toBeNull();
    expect(state.status).toBe("ready");
    expect(state.plan?.segments).toHaveLength(1);
    expect(state.plan?.totalDistanceKm).toBe(95);
    expect(state.plan?.summary).toMatch(/Chamonix/);
    expect(turn2.reply).toMatch(/Geneva/);
    expect(calls).toHaveLength(4);
  });

  it("feeds tool outputs back to Claude as tool_result blocks", async () => {
    const { client, calls } = fakeClient([
      toolUseResponse([
        {
          id: "tu_w",
          name: "get_weather",
          input: {
            location: { latitude: 45.92, longitude: 6.87 },
            date: "2026-06-15",
          },
        },
      ]),
      textResponse("Looks sunny that day."),
    ]);

    const orchestrator = createOrchestrator({
      claude: client,
      registry: createDefaultRegistry(),
    });

    const result = await orchestrator.sendMessage(
      orchestrator.newConversation(),
      "What's the weather like in Chamonix on June 15, 2026?",
    );

    expect(result.reply).toBe("Looks sunny that day.");
    expect(calls).toHaveLength(2);

    const secondCallMessages = calls[1]!.messages;
    const lastMessage = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastMessage.role).toBe("user");
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const toolResult = (lastMessage.content as Array<{ type: string }>).find(
      (c) => c.type === "tool_result",
    );
    expect(toolResult).toBeDefined();
  });

  it("stops at maxIterations and marks state as error", async () => {
    const stuck = toolUseResponse([
      {
        id: "tu_loop",
        name: "get_weather",
        input: {
          location: { latitude: 45.92, longitude: 6.87 },
          date: "2026-06-15",
        },
      },
    ]);
    const { client } = fakeClient(Array.from({ length: 10 }, () => stuck));

    const orchestrator = createOrchestrator({
      claude: client,
      registry: createDefaultRegistry(),
      maxIterations: 3,
    });

    const result = await orchestrator.sendMessage(
      orchestrator.newConversation(),
      "Plan me a trip.",
    );

    expect(result.state.status).toBe("error");
    expect(result.plan).toBeNull();
  });

  it("merges update_preferences calls into state.preferences", async () => {
    const { client } = fakeClient([
      toolUseResponse([
        {
          id: "tu_p1",
          name: "update_preferences",
          input: {
            startLocation: { latitude: 45.92, longitude: 6.87, name: "Chamonix" },
            durationDays: 3,
          },
        },
      ]),
      textResponse("Got it — where would you like to finish?"),
    ]);

    const orchestrator = createOrchestrator({
      claude: client,
      registry: createDefaultRegistry(),
    });

    const result = await orchestrator.sendMessage(
      orchestrator.newConversation(),
      "I want to start in Chamonix for 3 days.",
    );

    expect(result.state.preferences.startLocation?.name).toBe("Chamonix");
    expect(result.state.preferences.durationDays).toBe(3);
    expect(result.plan).toBeNull();
  });

  it("invalidates an existing plan when update_preferences changes a plan-relevant field", async () => {
    const { client } = fakeClient([
      // Turn 1: submit a plan in one shot.
      toolUseResponse([
        { id: "tu_submit", name: "submit_trip_plan", input: SAMPLE_PLAN },
      ]),
      textResponse("Plan submitted."),
      // Turn 2: user changes their mind — agent calls update_preferences
      // with an invalidating field, which should wipe the plan.
      toolUseResponse([
        {
          id: "tu_change",
          name: "update_preferences",
          input: { durationDays: 5 },
        },
      ]),
      textResponse("Re-planning for 5 days."),
    ]);

    const orchestrator = createOrchestrator({
      claude: client,
      registry: createDefaultRegistry(),
    });

    let state = orchestrator.newConversation();
    const turn1 = await orchestrator.sendMessage(state, "Plan me a trip.");
    state = turn1.state;
    expect(state.plan).not.toBeNull();
    expect(state.preferences.durationDays).toBe(1);

    const turn2 = await orchestrator.sendMessage(
      state,
      "Actually, let's make it 5 days.",
    );

    expect(turn2.plan).toBeNull();
    expect(turn2.state.plan).toBeNull();
    expect(turn2.state.status).toBe("needs_clarification");
    expect(turn2.state.preferences.durationDays).toBe(5);
  });

  it("snapshots preferences from submit_trip_plan into state", async () => {
    const { client } = fakeClient([
      toolUseResponse([
        { id: "tu_submit", name: "submit_trip_plan", input: SAMPLE_PLAN },
      ]),
      textResponse("Plan submitted."),
    ]);

    const orchestrator = createOrchestrator({
      claude: client,
      registry: createDefaultRegistry(),
    });

    const result = await orchestrator.sendMessage(
      orchestrator.newConversation(),
      "Plan me a trip from Chamonix to Geneva.",
    );

    expect(result.state.preferences.startLocation?.name).toBe("Chamonix");
    expect(result.state.preferences.endLocation?.name).toBe("Geneva");
    expect(result.state.preferences.durationDays).toBe(1);
  });

  it("returns an isError tool_result when a tool fails validation", async () => {
    const { client, calls } = fakeClient([
      toolUseResponse([
        {
          id: "tu_bad",
          name: "get_weather",
          input: { location: "not a geo point", date: "2026-06-15" },
        },
      ]),
      textResponse("Sorry, I'll try a different approach."),
    ]);

    const orchestrator = createOrchestrator({
      claude: client,
      registry: createDefaultRegistry(),
    });

    const result = await orchestrator.sendMessage(
      orchestrator.newConversation(),
      "Plan me a trip.",
    );

    expect(result.reply).toMatch(/different approach/);
    const secondCallMessages = calls[1]!.messages;
    const lastMessage = secondCallMessages[secondCallMessages.length - 1]!;
    const toolResult = (
      lastMessage.content as Array<{ type: string; isError?: boolean }>
    ).find((c) => c.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect((toolResult as { isError?: boolean }).isError).toBe(true);
  });
});
