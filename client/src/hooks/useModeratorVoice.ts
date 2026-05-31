import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Hook for moderator announcements. Speaks exclusively via ElevenLabs TTS
 * (server-proxied). There is intentionally no browser SpeechSynthesis
 * fallback — if ElevenLabs is unconfigured or a request fails, the moderator
 * is silent, but the failure is surfaced loudly (once) so the silence is
 * never mysterious.
 *
 * - Queues announcements so they never overlap.
 * - Caches audio blobs client-side so repeated phrases are instant.
 * - Reports isSpeaking state for UI indicators.
 */
export function useModeratorVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<{ text: string; resolve: () => void }>>([]);
  const processingRef = useRef(false);
  const blobCacheRef = useRef(new Map<string, string>()); // text → objectURL
  // Notify the user at most once per session that the moderator voice is down.
  const errorNotifiedRef = useRef(false);

  // Check once at mount whether ElevenLabs is configured on the server.
  const { data: elevenLabsAvailable } = trpc.tts.isAvailable.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const generateTts = trpc.tts.generate.useMutation();

  // Cleanup object URLs and audio element on unmount.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      blobCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const notifyUnavailable = useCallback((detail: string) => {
    if (errorNotifiedRef.current) return;
    errorNotifiedRef.current = true;
    toast.error(`AI moderator voice unavailable: ${detail}`, {
      id: "moderator-voice-unavailable",
      duration: 8000,
    });
  }, []);

  // Play audio from a base64-encoded MP3 string (or from client cache).
  const playAudio = useCallback((base64: string | null, text: string): Promise<void> => {
    return new Promise((resolve) => {
      let objectUrl = blobCacheRef.current.get(text);
      if (!objectUrl && base64) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        objectUrl = URL.createObjectURL(blob);
        blobCacheRef.current.set(text, objectUrl);
      }
      if (!objectUrl) { resolve(); return; }

      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); resolve(); };
      audio.onerror = () => { setIsSpeaking(false); resolve(); };
      audio.play().catch(() => { setIsSpeaking(false); resolve(); });
    });
  }, []);

  // Process the announcement queue one item at a time. ElevenLabs only.
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const { text, resolve } = queueRef.current.shift()!;

      try {
        // Replay from the client-side blob cache when we already have it.
        if (blobCacheRef.current.has(text)) {
          await playAudio(null, text);
          continue;
        }

        // Known-unconfigured: skip the round-trip and report it.
        if (elevenLabsAvailable === false) {
          notifyUnavailable("ElevenLabs is not configured on the server.");
          continue;
        }

        try {
          const result = await generateTts.mutateAsync({ text });
          if (result.audio) {
            await playAudio(result.audio, text);
            continue;
          }
          notifyUnavailable("ElevenLabs returned no audio.");
        } catch {
          notifyUnavailable("the ElevenLabs TTS request failed.");
        }
      } finally {
        // Resolve this announcement's promise once it has finished (also on
        // the `continue` paths above — `finally` still runs).
        resolve();
      }
    }

    processingRef.current = false;
  }, [elevenLabsAvailable, generateTts, playAudio, notifyUnavailable]);

  // Public API: enqueue an announcement. Resolves when it finishes playing
  // (or immediately if the voice is unavailable) so callers can await it.
  const speak = useCallback(
    (text: string): Promise<void> =>
      new Promise<void>((resolve) => {
        queueRef.current.push({ text, resolve });
        processQueue();
      }),
    [processQueue]
  );

  return { speak, isSpeaking };
}
