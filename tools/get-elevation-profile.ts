// Mock elevation profile. Sums haversine distance across waypoints, then
// samples elevation along the path as a sine arch (a single climb-and-
// descend) with high-frequency noise to mimic local terrain. Running
// gain/loss is computed as we sample so the totals match the points.

import { z } from "zod";
import type { ElevationProfile } from "../src/domain/index.js";
import {
  hashString,
  haversineKm,
  roundTo,
  seededRandom,
} from "./mock-utils.js";
import { geoPointSchema } from "./schemas.js";
import { defineTool } from "./types.js";

const inputSchema = z.object({
  waypoints: z.array(geoPointSchema).min(2),
  samples: z.number().int().min(2).max(200).default(24),
});

export const getElevationProfileTool = defineTool({
  name: "get_elevation_profile",
  description:
    "Compute the elevation profile along an ordered series of waypoints. Returns total gain/loss, min/max elevation, and sampled elevation points along the path.",
  inputSchema,
  execute: async ({ waypoints, samples }): Promise<ElevationProfile> => {
    const seed = waypoints
      .map((w) => `${w.latitude.toFixed(3)},${w.longitude.toFixed(3)}`)
      .join("|");
    const rand = seededRandom(hashString(`elev|${seed}`));

    let totalDistanceKm = 0;
    for (let i = 1; i < waypoints.length; i++) {
      totalDistanceKm += haversineKm(waypoints[i - 1]!, waypoints[i]!);
    }

    const baseElevationM = 150 + Math.round(rand() * 400);
    const peakAmplitudeM = 100 + Math.round(rand() * 500);

    let totalGainM = 0;
    let totalLossM = 0;
    let maxElevationM = -Infinity;
    let minElevationM = Infinity;
    let previousElevationM: number | null = null;

    const points = Array.from({ length: samples }, (_, i) => {
      const t = i / (samples - 1);
      const distanceKm = roundTo(totalDistanceKm * t, 1);
      const elevationM = Math.max(
        0,
        Math.round(
          baseElevationM +
            Math.sin(t * Math.PI) * peakAmplitudeM +
            Math.sin(t * Math.PI * 4) * (peakAmplitudeM * 0.15) +
            (rand() - 0.5) * 30,
        ),
      );
      if (previousElevationM !== null) {
        const delta = elevationM - previousElevationM;
        if (delta > 0) totalGainM += delta;
        else totalLossM += -delta;
      }
      previousElevationM = elevationM;
      maxElevationM = Math.max(maxElevationM, elevationM);
      minElevationM = Math.min(minElevationM, elevationM);
      return { distanceKm, elevationM };
    });

    return {
      totalGainM: Math.round(totalGainM),
      totalLossM: Math.round(totalLossM),
      maxElevationM,
      minElevationM,
      points,
    };
  },
});
