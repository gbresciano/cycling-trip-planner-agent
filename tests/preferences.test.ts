import { describe, expect, it } from "vitest";
import {
  applyPreferenceUpdate,
  createEmptyConversation,
  mergePreferences,
  preferencesInvalidatePlan,
  type ConversationState,
  type TripPlan,
  type TripPreferences,
} from "../src/domain/index.js";

function basePreferences(): TripPreferences {
  return {
    startLocation: { latitude: 45.92, longitude: 6.87, name: "Chamonix" },
    endLocation: { latitude: 46.2, longitude: 6.14, name: "Geneva" },
    startDate: "2026-06-15",
    durationDays: 5,
    minDailyKm: 60,
    maxDailyKm: 100,
    fitnessLevel: "intermediate",
    terrain: "mountainous",
    accommodationTypes: ["hotel"],
  };
}

function statePlan(): TripPlan {
  return {
    id: "plan-1",
    preferences: basePreferences(),
    summary: "Test plan",
    segments: [],
    totalDistanceKm: 0,
    totalElevationGainM: 0,
    generatedAt: "2026-05-11T12:00:00.000Z",
  };
}

function stateWithPrefsAndPlan(
  preferences: TripPreferences,
  plan: TripPlan | null,
): ConversationState {
  const base = createEmptyConversation(() => new Date("2026-05-11T12:00:00Z"));
  return {
    ...base,
    preferences,
    plan,
    status: plan ? "ready" : "gathering_preferences",
  };
}

describe("mergePreferences", () => {
  it("adds new fields without touching existing ones", () => {
    const merged = mergePreferences(
      { startDate: "2026-06-15" },
      { durationDays: 5 },
    );
    expect(merged).toEqual({ startDate: "2026-06-15", durationDays: 5 });
  });

  it("does not let `undefined` overwrite existing values", () => {
    const merged = mergePreferences(
      { startDate: "2026-06-15", durationDays: 5 },
      { durationDays: undefined },
    );
    expect(merged.durationDays).toBe(5);
  });

  it("overwrites when an explicit value is provided", () => {
    const merged = mergePreferences(
      { durationDays: 5 },
      { durationDays: 7 },
    );
    expect(merged.durationDays).toBe(7);
  });
});

describe("preferencesInvalidatePlan", () => {
  it("returns false when nothing changed", () => {
    const prefs = basePreferences();
    expect(preferencesInvalidatePlan(prefs, prefs)).toBe(false);
  });

  it.each<[string, Partial<TripPreferences>]>([
    ["startLocation", { startLocation: { latitude: 47, longitude: 8 } }],
    ["endLocation", { endLocation: { latitude: 48, longitude: 9 } }],
    ["startDate", { startDate: "2026-07-01" }],
    ["durationDays", { durationDays: 7 }],
    ["minDailyKm", { minDailyKm: 40 }],
    ["maxDailyKm", { maxDailyKm: 140 }],
    ["fitnessLevel", { fitnessLevel: "expert" }],
    ["terrain", { terrain: "flat" }],
    ["accommodationTypes", { accommodationTypes: ["camping"] }],
    ["budgetPerDay", { budgetPerDay: { amount: 200, currency: "EUR" } }],
  ])("returns true when %s changes", (_label, patch) => {
    const before = basePreferences();
    const after = { ...before, ...patch };
    expect(preferencesInvalidatePlan(before, after)).toBe(true);
  });

  it("ignores cosmetic fields (notes, mustVisit)", () => {
    const before = basePreferences();
    const after: TripPreferences = {
      ...before,
      notes: "Avoid highways",
      mustVisit: [{ latitude: 46, longitude: 6.5 }],
    };
    expect(preferencesInvalidatePlan(before, after)).toBe(false);
  });

  it("detects added fields where the previous value was undefined", () => {
    const before: Partial<TripPreferences> = { startDate: "2026-06-15" };
    const after: Partial<TripPreferences> = {
      startDate: "2026-06-15",
      startLocation: { latitude: 45.92, longitude: 6.87 },
    };
    expect(preferencesInvalidatePlan(before, after)).toBe(true);
  });

  it("treats identical-by-value GeoPoint objects as unchanged", () => {
    const before: Partial<TripPreferences> = {
      startLocation: { latitude: 45.92, longitude: 6.87, name: "Chamonix" },
    };
    const after: Partial<TripPreferences> = {
      startLocation: { latitude: 45.92, longitude: 6.87, name: "Chamonix" },
    };
    expect(preferencesInvalidatePlan(before, after)).toBe(false);
  });
});

describe("applyPreferenceUpdate", () => {
  const fixedNow = (): Date => new Date("2026-05-12T09:00:00Z");

  it("merges preferences without touching the plan when nothing relevant changed", () => {
    const before = stateWithPrefsAndPlan(basePreferences(), statePlan());
    const after = applyPreferenceUpdate(
      before,
      { notes: "Avoid highways" },
      fixedNow,
    );

    expect(after.preferences.notes).toBe("Avoid highways");
    expect(after.plan).toBe(before.plan);
    expect(after.status).toBe("ready");
  });

  it("wipes the plan when an invalidating field changes", () => {
    const before = stateWithPrefsAndPlan(basePreferences(), statePlan());
    const after = applyPreferenceUpdate(
      before,
      { durationDays: 7 },
      fixedNow,
    );

    expect(after.plan).toBeNull();
    expect(after.status).toBe("planning");
    expect(after.preferences.durationDays).toBe(7);
  });

  it("does nothing to plan/status when no plan exists", () => {
    const before = stateWithPrefsAndPlan(basePreferences(), null);
    const after = applyPreferenceUpdate(
      before,
      { startLocation: { latitude: 0, longitude: 0 } },
      fixedNow,
    );

    expect(after.plan).toBeNull();
    expect(after.status).toBe(before.status);
  });

  it("bumps updatedAt to the current clock value", () => {
    const before = stateWithPrefsAndPlan(basePreferences(), statePlan());
    const after = applyPreferenceUpdate(before, { notes: "x" }, fixedNow);
    expect(after.updatedAt).toBe("2026-05-12T09:00:00.000Z");
  });
});
