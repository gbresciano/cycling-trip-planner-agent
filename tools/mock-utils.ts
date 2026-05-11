// Mock-data helpers shared by every tool.
//
// Determinism is the point: same input → same output. Tests can assert
// against exact values, prompt caching stays valid across identical
// requests, and debugging is much easier when output doesn't drift.
// We seed a Park-Miller LCG with an FNV-1a hash of the input — gives
// us "random-looking" but reproducible numbers without a PRNG dep.

import type { GeoPoint } from "../src/domain/index.js";

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Park-Miller minimal-standard LCG. Plain multiplication (not Math.imul)
// because Math.imul returns a signed 32-bit int — fine for the FNV hash
// above, but breaks an LCG that needs unsigned modular arithmetic.
// 16807 × 2^31-1 fits in JS's safe-integer range, so the modulus is
// exact.
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function interpolate(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
