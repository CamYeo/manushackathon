export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "dev-secret-do-not-use-in-prod",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Standard OpenAI key used as fallback when Manus Forge keys are absent.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Google Gemini API key — uses Google's OpenAI-compatible endpoint.
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // ElevenLabs TTS for moderator voice. Falls back to browser SpeechSynthesis.
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",   // default: Adam
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID ?? "",   // default: eleven_flash_v2_5
  // When true AND not in production, skip Manus OAuth and use a mock local user.
  // Set DEV_BYPASS_AUTH=true in your .env or shell to enable.
  devBypassAuth:
    process.env.DEV_BYPASS_AUTH === "true" &&
    process.env.NODE_ENV !== "production",
};
