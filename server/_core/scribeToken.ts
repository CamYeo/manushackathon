/**
 * ElevenLabs Scribe Realtime — single-use token minting.
 *
 * The browser must NOT see ELEVENLABS_API_KEY. Instead the server exchanges
 * the API key for a short-lived (15 min), single-use token that the browser
 * passes to the Scribe Realtime WebSocket.
 *
 * Endpoint (verified against ElevenLabs docs):
 *   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe
 *   Header: xi-api-key: <ELEVENLABS_API_KEY>
 *   Body:   (none)
 *   200:    { "token": string }
 */
import { ENV } from "./env";

export const SCRIBE_MODEL_ID = "scribe_v2_realtime";

const SCRIBE_TOKEN_ENDPOINT =
  "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";

export type ScribeTokenResult =
  | { token: string }
  | {
      error: string;
      code: "NOT_CONFIGURED" | "REQUEST_FAILED";
      details?: string;
    };

export async function createScribeSingleUseToken(): Promise<ScribeTokenResult> {
  if (!ENV.elevenLabsApiKey) {
    return {
      error: "Realtime transcription is not configured",
      code: "NOT_CONFIGURED",
      details: "ELEVENLABS_API_KEY is not set on the server",
    };
  }

  try {
    const response = await fetch(SCRIBE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": ENV.elevenLabsApiKey },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        error: "Failed to create Scribe token",
        code: "REQUEST_FAILED",
        details: `${response.status} ${response.statusText}${
          detail ? `: ${detail}` : ""
        }`,
      };
    }

    const data = (await response.json()) as { token?: string };
    if (!data.token || typeof data.token !== "string") {
      return {
        error: "Scribe token missing from response",
        code: "REQUEST_FAILED",
        details: "ElevenLabs returned no token field",
      };
    }

    return { token: data.token };
  } catch (error) {
    return {
      error: "Scribe token request failed",
      code: "REQUEST_FAILED",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
