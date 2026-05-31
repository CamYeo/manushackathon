import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Contained import graph: scribeToken.ts only imports ./_core/env, so
// mocking env here cannot leak into other test files / routers.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { elevenLabsApiKey: "test-key" },
}));
vi.mock("./_core/env", () => ({ ENV: mockEnv }));

const realFetch = global.fetch;

describe("createScribeSingleUseToken", () => {
  beforeEach(() => {
    mockEnv.elevenLabsApiKey = "test-key";
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns NOT_CONFIGURED when the API key is absent (never silent)", async () => {
    mockEnv.elevenLabsApiKey = "";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { createScribeSingleUseToken } = await import("./_core/scribeToken");
    const result = await createScribeSingleUseToken();

    expect("error" in result && result.code).toBe("NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled(); // never reaches ElevenLabs
  });

  it("exchanges the API key for a single-use token", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: "single-use-123" }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { createScribeSingleUseToken } = await import("./_core/scribeToken");
    const result = await createScribeSingleUseToken();

    expect(result).toEqual({ token: "single-use-123" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: { "xi-api-key": "test-key" },
    });
  });

  it("reports REQUEST_FAILED on a non-OK upstream response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve("bad key"),
    }) as unknown as typeof fetch;

    const { createScribeSingleUseToken } = await import("./_core/scribeToken");
    const result = await createScribeSingleUseToken();

    expect("error" in result && result.code).toBe("REQUEST_FAILED");
  });

  it("reports REQUEST_FAILED when the token field is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    const { createScribeSingleUseToken } = await import("./_core/scribeToken");
    const result = await createScribeSingleUseToken();

    expect("error" in result && result.code).toBe("REQUEST_FAILED");
  });

  it("reports REQUEST_FAILED when fetch throws", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const { createScribeSingleUseToken } = await import("./_core/scribeToken");
    const result = await createScribeSingleUseToken();

    expect("error" in result && result.code).toBe("REQUEST_FAILED");
  });
});
