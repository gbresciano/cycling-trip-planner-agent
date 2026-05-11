// Mock accommodation search. Generates up to `limit` results from a
// type-keyed pool of plausible names + base prices, scattered ~2km around
// the query location. Respects `type` filter and `maxPricePerNight`.

import { z } from "zod";
import type { Accommodation, AccommodationType } from "../src/domain/index.js";
import { hashString, roundTo, seededRandom } from "./mock-utils.js";
import {
  accommodationTypeSchema,
  geoPointSchema,
  isoDateSchema,
} from "./schemas.js";
import { defineTool } from "./types.js";

const inputSchema = z.object({
  location: geoPointSchema,
  date: isoDateSchema,
  type: accommodationTypeSchema.optional(),
  maxPricePerNight: z.number().positive().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

function namePool(type: AccommodationType): readonly string[] {
  switch (type) {
    case "hotel":
      return [
        "Grand Plaza Hotel",
        "Riverside Hotel",
        "Mountain View Inn",
        "Central Lodge",
        "Heritage Hotel",
      ];
    case "hostel":
      return [
        "Cyclist's Rest Hostel",
        "Backpacker Base",
        "Trail Hostel",
        "Wanderer's Home",
      ];
    case "bnb":
      return [
        "Maison Elise",
        "The Old Mill B&B",
        "Vineyard Cottage",
        "Hillside Retreat",
      ];
    case "camping":
      return [
        "Pine Forest Campground",
        "Lakeside Camp",
        "Riverbend Camping",
        "Summit Camp",
      ];
    case "any":
      return ["Local Lodging"];
  }
}

function basePriceEur(type: AccommodationType): number {
  switch (type) {
    case "hotel":
      return 120;
    case "hostel":
      return 35;
    case "bnb":
      return 85;
    case "camping":
      return 20;
    case "any":
      return 80;
  }
}

function amenitiesFor(type: AccommodationType): string[] {
  switch (type) {
    case "camping":
      return ["showers", "fire pit", "bike storage"];
    case "hostel":
      return ["wifi", "shared kitchen", "bike storage"];
    case "bnb":
      return ["wifi", "breakfast", "bike storage"];
    case "hotel":
      return ["wifi", "breakfast", "bike storage", "restaurant"];
    case "any":
      return ["wifi"];
  }
}

const REAL_TYPES: readonly AccommodationType[] = [
  "hotel",
  "hostel",
  "bnb",
  "camping",
];

export const findAccommodationTool = defineTool({
  name: "find_accommodation",
  description:
    "Search for cycling-friendly accommodations near a location for a given date. Returns a list of places with type, price per night, location, rating, and amenities.",
  inputSchema,
  execute: async ({
    location,
    date,
    type,
    maxPricePerNight,
    limit,
  }): Promise<Accommodation[]> => {
    const rand = seededRandom(
      hashString(
        `accom|${location.latitude},${location.longitude}|${date}|${type ?? "any"}`,
      ),
    );

    const allowedTypes =
      type && type !== "any" ? [type] : REAL_TYPES;

    const results: Accommodation[] = [];
    let attempts = 0;
    while (results.length < limit && attempts < limit * 4) {
      attempts++;
      const pickedType =
        allowedTypes[Math.floor(rand() * allowedTypes.length)] ?? "hotel";
      const names = namePool(pickedType);
      const name = names[Math.floor(rand() * names.length)] ?? "Local Lodging";
      const price = Math.round(basePriceEur(pickedType) * (0.7 + rand() * 0.8));
      if (maxPricePerNight !== undefined && price > maxPricePerNight) continue;

      results.push({
        name: `${name} #${results.length + 1}`,
        type: pickedType,
        location: {
          latitude: roundTo(location.latitude + (rand() - 0.5) * 0.02, 5),
          longitude: roundTo(location.longitude + (rand() - 0.5) * 0.02, 5),
        },
        pricePerNight: { amount: price, currency: "EUR" },
        rating: roundTo(3 + rand() * 2, 1),
        amenities: amenitiesFor(pickedType),
      });
    }

    return results;
  },
});
