// Mock route generator. Takes the great-circle distance as the floor,
// adds ~25% road windiness, and shapes an elevation profile as a sine
// arch over the route plus seeded noise. Output is realistic enough to
// flow through the rest of the planning pipeline without surprising the
// downstream consumers.

import { z } from "zod";
import type { Route } from "../src/domain/index.js";
import {
  hashString,
  haversineKm,
  interpolate,
  roundTo,
  seededRandom,
} from "./mock-utils.js";
import { geoPointSchema } from "./schemas.js";
import { defineTool } from "./types.js";

const inputSchema = z.object({
  start: geoPointSchema,
  end: geoPointSchema,
  preferGravel: z.boolean().optional(),
});

const WAYPOINT_COUNT = 8;
const ROAD_WINDINESS = 1.25;
const AVG_SPEED_KPH = 20;

export const getRouteTool = defineTool({
  name: "get_route",
  description:
    "Fetch a cycling route between two geographic points. Returns distance, estimated duration, an elevation profile, intermediate waypoints, surface type, and difficulty.",
  inputSchema,
  execute: async ({ start, end, preferGravel }): Promise<Route> => {
    const rand = seededRandom(
      hashString(
        `route|${start.latitude},${start.longitude}|${end.latitude},${end.longitude}`,
      ),
    );

    const straightKm = haversineKm(start, end);
    const distanceKm = roundTo(straightKm * ROAD_WINDINESS, 1);

    const waypoints = Array.from({ length: WAYPOINT_COUNT + 1 }, (_, i) =>
      interpolate(start, end, i / WAYPOINT_COUNT),
    );

    const totalGainM = Math.round(distanceKm * (12 + rand() * 18));
    const totalLossM = Math.round(distanceKm * (12 + rand() * 18));
    const baseElevationM = 150 + Math.round(rand() * 400);
    const maxElevationM = baseElevationM + Math.round(rand() * 600);
    const minElevationM = Math.max(
      0,
      baseElevationM - Math.round(rand() * 200),
    );

    const points = waypoints.map((_, i) => {
      const t = i / WAYPOINT_COUNT;
      const elevationM = Math.round(
        baseElevationM +
          Math.sin(t * Math.PI) * (maxElevationM - baseElevationM) +
          (rand() - 0.5) * 40,
      );
      return { distanceKm: roundTo(distanceKm * t, 1), elevationM };
    });

    const difficulty: Route["difficulty"] =
      totalGainM > 1500 ? "expert" : totalGainM > 900 ? "hard" : totalGainM > 400 ? "moderate" : "easy";

    return {
      distanceKm,
      estimatedDurationHours: roundTo(distanceKm / AVG_SPEED_KPH, 1),
      elevation: {
        totalGainM,
        totalLossM,
        maxElevationM,
        minElevationM,
        points,
      },
      waypoints,
      surface: preferGravel ? "gravel" : "paved",
      difficulty,
    };
  },
});
