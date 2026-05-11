// Mock weather forecast. Temperature is derived from latitude (cooler
// toward the poles) plus a seasonal cosine that flips sign across
// hemispheres. Conditions are sampled from a weighted distribution
// (mostly sunny/cloudy, occasional rain); precipitation is conditional
// on the picked condition.

import { z } from "zod";
import type { Weather } from "../src/domain/index.js";
import { hashString, seededRandom } from "./mock-utils.js";
import { geoPointSchema, isoDateSchema } from "./schemas.js";
import { defineTool } from "./types.js";

const inputSchema = z.object({
  location: geoPointSchema,
  date: isoDateSchema,
});

const CONDITIONS = [
  { label: "sunny", weight: 0.35 },
  { label: "partly cloudy", weight: 0.3 },
  { label: "cloudy", weight: 0.15 },
  { label: "light rain", weight: 0.12 },
  { label: "rain", weight: 0.06 },
  { label: "thunderstorm", weight: 0.02 },
] as const;

const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function pickCondition(r: number): (typeof CONDITIONS)[number]["label"] {
  let acc = 0;
  for (const c of CONDITIONS) {
    acc += c.weight;
    if (r < acc) return c.label;
  }
  return "sunny";
}

export const getWeatherTool = defineTool({
  name: "get_weather",
  description:
    "Get the weather forecast for a specific location and date. Returns temperature range, conditions, precipitation, and wind.",
  inputSchema,
  execute: async ({ location, date }): Promise<Weather> => {
    const rand = seededRandom(
      hashString(`weather|${location.latitude},${location.longitude}|${date}`),
    );

    const dateObj = new Date(`${date}T12:00:00Z`);
    const month = dateObj.getUTCMonth();
    const seasonalC =
      Math.cos(((month - 6) / 12) * Math.PI * 2) *
      (location.latitude >= 0 ? -10 : 10);
    const latitudeC = 28 - Math.abs(location.latitude) * 0.55;
    const baseTempC = latitudeC + seasonalC;

    const tempMinC = Math.round(baseTempC - 5 + (rand() - 0.5) * 3);
    const tempMaxC = Math.round(baseTempC + 5 + (rand() - 0.5) * 3);

    const conditions = pickCondition(rand());
    const precipitationMm =
      conditions === "rain"
        ? Math.round(rand() * 15 + 3)
        : conditions === "light rain"
          ? Math.round(rand() * 3 + 1)
          : conditions === "thunderstorm"
            ? Math.round(rand() * 25 + 10)
            : 0;

    return {
      date,
      conditions,
      temperatureMinC: tempMinC,
      temperatureMaxC: tempMaxC,
      precipitationMm,
      windSpeedKph: Math.round(rand() * 25 + 3),
      windDirection: WIND_DIRECTIONS[Math.floor(rand() * WIND_DIRECTIONS.length)],
    };
  },
});
