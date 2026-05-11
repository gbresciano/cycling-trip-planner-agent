// Domain models for the trip planner.
//
// Convention: `TripPreferences` is *user input* — what the traveler asked
// for. Everything else (`TripPlan`, `DailySegment`, `Route`, `Weather`,
// `Accommodation`, `ElevationProfile`) is *derived* by the agent from
// those preferences plus tool outputs. Keeping the two cleanly separated
// lets the planning pipeline evolve without churning the contract the
// user sees.

// Plain string aliases — they document the expected format without
// runtime cost. Branded types would be stricter but overkill here.
export type IsoDate = string;
export type IsoDateTime = string;

export interface GeoPoint {
  latitude: number;
  longitude: number;
  name?: string;
}

export interface Money {
  amount: number;
  currency: string;
}

export type FitnessLevel = "beginner" | "intermediate" | "advanced" | "expert";

export type TerrainPreference =
  | "flat"
  | "rolling"
  | "hilly"
  | "mountainous"
  | "mixed";

export type AccommodationType =
  | "hotel"
  | "hostel"
  | "bnb"
  | "camping"
  | "any";

export type SurfaceType = "paved" | "gravel" | "trail" | "mixed";

export type RouteDifficulty = "easy" | "moderate" | "hard" | "expert";

// User-facing input. The agent fills these in incrementally during the
// conversation, so this also appears as `Partial<TripPreferences>` on
// `ConversationState.preferences`.
export interface TripPreferences {
  startLocation: GeoPoint;
  endLocation?: GeoPoint;
  startDate: IsoDate;
  durationDays: number;
  minDailyKm: number;
  maxDailyKm: number;
  fitnessLevel: FitnessLevel;
  terrain: TerrainPreference;
  accommodationTypes: AccommodationType[];
  budgetPerDay?: Money;
  mustVisit?: GeoPoint[];
  notes?: string;
}

export interface ElevationPoint {
  distanceKm: number;
  elevationM: number;
}

export interface ElevationProfile {
  totalGainM: number;
  totalLossM: number;
  maxElevationM: number;
  minElevationM: number;
  points: ElevationPoint[];
}

export interface Route {
  distanceKm: number;
  estimatedDurationHours: number;
  elevation: ElevationProfile;
  waypoints: GeoPoint[];
  surface: SurfaceType;
  difficulty: RouteDifficulty;
}

export interface Weather {
  date: IsoDate;
  conditions: string;
  temperatureMinC: number;
  temperatureMaxC: number;
  precipitationMm: number;
  windSpeedKph: number;
  windDirection?: string;
}

export interface Accommodation {
  name: string;
  type: AccommodationType;
  location: GeoPoint;
  pricePerNight?: Money;
  rating?: number;
  bookingUrl?: string;
  amenities?: string[];
}

export interface DailySegment {
  day: number;
  date: IsoDate;
  start: GeoPoint;
  end: GeoPoint;
  route: Route;
  weather: Weather;
  accommodation: Accommodation;
  highlights?: string[];
  notes?: string;
}

// The final derived artifact. Carries its own `preferences` snapshot so
// a plan stays reproducible against the request that produced it, even
// if the user later changes their preferences.
export interface TripPlan {
  id: string;
  preferences: TripPreferences;
  summary: string;
  segments: DailySegment[];
  totalDistanceKm: number;
  totalElevationGainM: number;
  generatedAt: IsoDateTime;
}
