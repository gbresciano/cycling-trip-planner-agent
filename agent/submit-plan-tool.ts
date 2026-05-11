// The "submit" tool isn't a data-fetching tool — it's how the agent
// signals "I'm done, here is the structured result." Modeling it as a
// regular `Tool` keeps the orchestration loop uniform: tool_use blocks
// are handled the same way regardless of which tool was called, and the
// orchestrator only checks `name` when deciding whether to capture the
// plan onto conversation state.
//
// `execute` returns a constant success string. The real side effect —
// storing the plan on state — happens in the orchestrator's
// `executeToolCall`, not here.

import { defineTool } from "../tools/types.js";
import { submitTripPlanInputSchema } from "./plan-schemas.js";

export const SUBMIT_TRIP_PLAN_TOOL_NAME = "submit_trip_plan";

export const submitTripPlanTool = defineTool({
  name: SUBMIT_TRIP_PLAN_TOOL_NAME,
  description:
    "Commit the final structured trip plan after all preferences have been gathered and all route, weather, and accommodation data has been collected. Pass the complete preferences, a 2-4 sentence summary, and one segment per day with the data returned by the research tools.",
  inputSchema: submitTripPlanInputSchema,
  execute: async () => "Trip plan submitted successfully.",
});
