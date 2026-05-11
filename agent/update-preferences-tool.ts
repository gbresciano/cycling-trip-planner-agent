// Like `submit_trip_plan`, this isn't a data-fetching tool — it's how
// the agent records preferences it has learned (or that the user has
// changed) during the conversation. Modeling it as a regular `Tool`
// keeps the orchestration loop uniform; the actual state mutation
// (merge + plan invalidation) happens in the orchestrator's
// `executeToolCall`, not here.

import { defineTool } from "../tools/types.js";
import { tripPreferencesPartialSchema } from "./plan-schemas.js";

export const UPDATE_PREFERENCES_TOOL_NAME = "update_preferences";

export const updatePreferencesTool = defineTool({
  name: UPDATE_PREFERENCES_TOOL_NAME,
  description:
    "Record trip preferences as you learn them, or update them when the user changes their mind. Pass only the fields you want to set or change — omitted fields are left untouched. Changing a plan-relevant field (start/end, dates, distances, fitness, terrain, accommodation, budget) clears any previously generated plan and you must re-research and call submit_trip_plan again.",
  inputSchema: tripPreferencesPartialSchema,
  execute: async () => "Preferences updated.",
});
