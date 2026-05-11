// Runtime schemas for the `submit_trip_plan` tool input.
//
// The agent will call this tool with arbitrary JSON; zod validates it
// before we trust it as a `TripPlan`. Each schema below mirrors a domain
// type 1:1 — the duplication is intentional: domain types are
// compile-time contracts (TS), schemas are runtime guards (zod). They
// live next to the agent (not in src/domain/) because runtime validation
// is an agent-only concern.

import { z } from "zod";
import { accommodationTypeSchema, geoPointSchema, isoDateSchema } from "../tools/schemas.js";

const moneySchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1),
});

const elevationProfileSchema = z.object({
  totalGainM: z.number().nonnegative(),
  totalLossM: z.number().nonnegative(),
  maxElevationM: z.number(),
  minElevationM: z.number(),
  points: z
    .array(
      z.object({
        distanceKm: z.number().nonnegative(),
        elevationM: z.number(),
      }),
    )
    .min(2),
});

const routeSchema = z.object({
  distanceKm: z.number().positive(),
  estimatedDurationHours: z.number().positive(),
  elevation: elevationProfileSchema,
  waypoints: z.array(geoPointSchema).min(2),
  surface: z.enum(["paved", "gravel", "trail", "mixed"]),
  difficulty: z.enum(["easy", "moderate", "hard", "expert"]),
});

const weatherSchema = z.object({
  date: isoDateSchema,
  conditions: z.string().min(1),
  temperatureMinC: z.number(),
  temperatureMaxC: z.number(),
  precipitationMm: z.number().nonnegative(),
  windSpeedKph: z.number().nonnegative(),
  windDirection: z.string().optional(),
});

const accommodationSchema = z.object({
  name: z.string().min(1),
  type: accommodationTypeSchema,
  location: geoPointSchema,
  pricePerNight: moneySchema.optional(),
  rating: z.number().min(0).max(5).optional(),
  bookingUrl: z.string().url().optional(),
  amenities: z.array(z.string()).optional(),
});

const dailySegmentSchema = z.object({
  day: z.number().int().positive(),
  date: isoDateSchema,
  start: geoPointSchema,
  end: geoPointSchema,
  route: routeSchema,
  weather: weatherSchema,
  accommodation: accommodationSchema,
  highlights: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const tripPreferencesSchema = z.object({
  startLocation: geoPointSchema,
  endLocation: geoPointSchema.optional(),
  startDate: isoDateSchema,
  durationDays: z.number().int().positive(),
  minDailyKm: z.number().positive(),
  maxDailyKm: z.number().positive(),
  fitnessLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  terrain: z.enum(["flat", "rolling", "hilly", "mountainous", "mixed"]),
  accommodationTypes: z.array(accommodationTypeSchema).min(1),
  budgetPerDay: moneySchema.optional(),
  mustVisit: z.array(geoPointSchema).optional(),
  notes: z.string().optional(),
});

// Partial variant used by `update_preferences`: the agent calls this
// tool whenever it learns or changes a field mid-conversation, so every
// field has to be individually omittable. `.strict()` rejects unknown
// keys — a hallucinated field name should surface as a tool error the
// agent can react to, not be silently dropped.
export const tripPreferencesPartialSchema = tripPreferencesSchema.partial().strict();

export const submitTripPlanInputSchema = z.object({
  preferences: tripPreferencesSchema,
  summary: z.string().min(20).describe("A 2-4 sentence overview of the trip for the user."),
  segments: z.array(dailySegmentSchema).min(1),
});

export type SubmitTripPlanInput = z.infer<typeof submitTripPlanInputSchema>;
