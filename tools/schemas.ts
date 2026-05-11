// Shared zod schemas reused across multiple tool inputs. Defining them
// once keeps tool definitions short and ensures every tool that takes a
// location validates it the same way (latitude/longitude bounds, optional
// name). Tool-specific schemas live in each tool's own file.

import { z } from "zod";

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().min(1).optional(),
});

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO 8601 date (YYYY-MM-DD)");

export const accommodationTypeSchema = z.enum([
  "hotel",
  "hostel",
  "bnb",
  "camping",
  "any",
]);
