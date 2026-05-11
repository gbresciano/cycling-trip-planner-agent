import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("server", () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
  });

  it("responds to /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
