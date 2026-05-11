// Pure functions over `TripPreferences`.
//
// Why this exists: as a conversation progresses, the agent (or a future
// extractor) updates preferences incrementally. Some changes are cosmetic
// (a note, an added must-see waypoint) and leave any existing plan
// valid; others (a different start city, a longer trip, a tighter
// budget) invalidate the plan entirely. Centralizing the "what counts as
// invalidation" decision here keeps it out of the orchestrator and makes
// it independently testable.

import type {
  ConversationState,
  TripPreferences,
} from "./index.js";

// Fields that affect the routing, scheduling, or accommodation
// pipeline. Any change here means the previously generated plan no
// longer reflects the user's request and must be regenerated.
const PLAN_INVALIDATING_KEYS = [
  "startLocation",
  "endLocation",
  "startDate",
  "durationDays",
  "minDailyKm",
  "maxDailyKm",
  "fitnessLevel",
  "terrain",
  "accommodationTypes",
  "budgetPerDay",
] as const satisfies readonly (keyof TripPreferences)[];

// Last-write-wins merge with the explicit rule that `undefined` does
// *not* overwrite an existing value. This makes it safe to pass a
// "patch" object containing only the fields the agent learned this
// turn without accidentally clearing earlier fields.
export function mergePreferences(
  current: Partial<TripPreferences>,
  updates: Partial<TripPreferences>,
): Partial<TripPreferences> {
  const result: Partial<TripPreferences> = { ...current };
  for (const key of Object.keys(updates) as Array<keyof TripPreferences>) {
    const value = updates[key];
    if (value !== undefined) {
      (result as Record<keyof TripPreferences, unknown>)[key] = value;
    }
  }
  return result;
}

// True when any plan-relevant field actually changed value. Cosmetic
// fields (notes, mustVisit) are ignored — they don't invalidate a plan.
export function preferencesInvalidatePlan(
  before: Partial<TripPreferences>,
  after: Partial<TripPreferences>,
): boolean {
  for (const key of PLAN_INVALIDATING_KEYS) {
    if (!isSamePreferenceValue(before[key], after[key])) {
      return true;
    }
  }
  return false;
}

// High-level operation used by callers (orchestrator, API): merge new
// preferences into state and wipe the plan if (and only if) the
// previously-generated plan no longer reflects those preferences.
export function applyPreferenceUpdate(
  state: ConversationState,
  updates: Partial<TripPreferences>,
  now: () => Date = () => new Date(),
): ConversationState {
  const merged = mergePreferences(state.preferences, updates);
  // We only flip status / clear `plan` when a plan actually existed —
  // otherwise nothing to invalidate.
  const invalidated =
    state.plan !== null && preferencesInvalidatePlan(state.preferences, merged);
  return {
    ...state,
    preferences: merged,
    plan: invalidated ? null : state.plan,
    status: invalidated ? "planning" : state.status,
    updatedAt: now().toISOString(),
  };
}

// Structured comparison via JSON serialization. Adequate for the
// preference value space (primitives, small flat objects like GeoPoint
// and Money, short string arrays); the values are always constructed
// from literals with a deterministic key order, so byte equality is a
// safe proxy for value equality here.
function isSamePreferenceValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
