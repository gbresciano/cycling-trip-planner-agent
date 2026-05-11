import { findAccommodationTool } from "./find-accommodation.js";
import { getElevationProfileTool } from "./get-elevation-profile.js";
import { getRouteTool } from "./get-route.js";
import { getWeatherTool } from "./get-weather.js";
import { ToolRegistry } from "./registry.js";

export * from "./types.js";
export * from "./registry.js";
export {
  findAccommodationTool,
  getElevationProfileTool,
  getRouteTool,
  getWeatherTool,
};

export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(getRouteTool)
    .register(findAccommodationTool)
    .register(getWeatherTool)
    .register(getElevationProfileTool);
}
