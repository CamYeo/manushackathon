import { ENV } from "./_core/env";

// In-memory cache: short moderator phrases repeat often (time warnings, etc.).
// Key = text, Value = audio buffer. Cleared on server restart.
const audioCache = new Map<string, Buffer>();

const DEFAULTS = {
  voiceId: "TxGEqnHWrfWFTfGW9XjX", // "Josh" — warm, natural male voice
  modelId: "eleven_multilingual_v2",  // Highest quality, most human-sounding
  voiceSettings: {
    stability: 0.75,
    similarity_boost: 0.75,
    style: 0.15,             // Slight expressiveness for natural delivery
    use_speaker_boost: true,
  },
} as const;

export function isElevenLabsConfigured(): boolean {
  return Boolean(ENV.elevenLabsApiKey);
}

/**
 * Generate speech audio from text via ElevenLabs TTS API.
 * Returns an MP3 buffer, or null if the service is unavailable/fails.
 * Results are cached in memory — identical text returns instantly on repeat.
 */
export async function generateSpeech(text: string): Promise<Buffer | null> {
  if (!ENV.elevenLabsApiKey) return null;

  const cached = audioCache.get(text);
  if (cached) return cached;

  const voiceId = ENV.elevenLabsVoiceId || DEFAULTS.voiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ENV.elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ENV.elevenLabsModelId || DEFAULTS.modelId,
        voice_settings: DEFAULTS.voiceSettings,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        `[ElevenLabs] TTS failed: ${response.status} ${response.statusText} ${detail}`
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    audioCache.set(text, buffer);
    return buffer;
  } catch (error) {
    console.error("[ElevenLabs] TTS request error:", error);
    return null;
  }
}
