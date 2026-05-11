import { describe, expect, it } from "vitest";
import {
  createDefaultRegistry,
  findAccommodationTool,
  getElevationProfileTool,
  getRouteTool,
  getWeatherTool,
  ToolNotFoundError,
} from "../tools/index.js";

const CHAMONIX = { latitude: 45.9237, longitude: 6.8694 };
const GENEVA = { latitude: 46.2044, longitude: 6.1432 };

describe("tool registry", () => {
  it("registers the four mock tools", () => {
    const registry = createDefaultRegistry();
    expect(registry.list().map((t) => t.name)).toEqual([
      "get_route",
      "find_accommodation",
      "get_weather",
      "get_elevation_profile",
    ]);
  });

  it("throws ToolNotFoundError for unknown tool", async () => {
    const registry = createDefaultRegistry();
    await expect(registry.invoke("does_not_exist", {})).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
  });

  it("rejects malformed input via zod", async () => {
    const registry = createDefaultRegistry();
    await expect(
      registry.invoke("get_weather", { location: "nope", date: "2026-06-15" }),
    ).rejects.toThrow();
  });

  it("rejects duplicate registration", () => {
    const registry = createDefaultRegistry();
    expect(() => registry.register(getRouteTool)).toThrow(/already registered/);
  });
});

describe("get_route", () => {
  it("returns a structurally valid route", async () => {
    const route = await getRouteTool.execute({ start: CHAMONIX, end: GENEVA });
    expect(route.distanceKm).toBeGreaterThan(0);
    expect(route.estimatedDurationHours).toBeGreaterThan(0);
    expect(route.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(route.elevation.points.length).toBe(route.waypoints.length);
    expect(route.surface).toBe("paved");
  });

  it("honours preferGravel", async () => {
    const route = await getRouteTool.execute({
      start: CHAMONIX,
      end: GENEVA,
      preferGravel: true,
    });
    expect(route.surface).toBe("gravel");
  });

  it("is deterministic for the same input", async () => {
    const a = await getRouteTool.execute({ start: CHAMONIX, end: GENEVA });
    const b = await getRouteTool.execute({ start: CHAMONIX, end: GENEVA });
    expect(a).toEqual(b);
  });
});

describe("find_accommodation", () => {
  it("returns the requested number of results", async () => {
    const results = await findAccommodationTool.execute({
      location: CHAMONIX,
      date: "2026-06-15",
      limit: 4,
    });
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.location.latitude).toBeCloseTo(CHAMONIX.latitude, 1);
      expect(r.pricePerNight?.currency).toBe("EUR");
    }
  });

  it("filters by maxPricePerNight", async () => {
    const results = await findAccommodationTool.execute({
      location: CHAMONIX,
      date: "2026-06-15",
      maxPricePerNight: 40,
      limit: 5,
    });
    for (const r of results) {
      expect(r.pricePerNight?.amount).toBeLessThanOrEqual(40);
    }
  });
});

describe("get_weather", () => {
  it("returns plausible weather", async () => {
    const w = await getWeatherTool.execute({
      location: CHAMONIX,
      date: "2026-07-15",
    });
    expect(w.temperatureMaxC).toBeGreaterThanOrEqual(w.temperatureMinC);
    expect(w.precipitationMm).toBeGreaterThanOrEqual(0);
    expect(w.windSpeedKph).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic for the same input", async () => {
    const input = { location: CHAMONIX, date: "2026-07-15" };
    const a = await getWeatherTool.execute(input);
    const b = await getWeatherTool.execute(input);
    expect(a).toEqual(b);
  });
});

describe("get_elevation_profile", () => {
  it("computes gain, loss, and sampled points", async () => {
    const profile = await getElevationProfileTool.execute({
      waypoints: [CHAMONIX, GENEVA],
      samples: 10,
    });
    expect(profile.points).toHaveLength(10);
    expect(profile.totalGainM).toBeGreaterThanOrEqual(0);
    expect(profile.totalLossM).toBeGreaterThanOrEqual(0);
    expect(profile.maxElevationM).toBeGreaterThanOrEqual(profile.minElevationM);
  });

  it("rejects a single waypoint via schema", async () => {
    const registry = createDefaultRegistry();
    await expect(
      registry.invoke("get_elevation_profile", {
        waypoints: [CHAMONIX],
        samples: 10,
      }),
    ).rejects.toThrow();
  });
});
