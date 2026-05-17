import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook for moderator announcements. Uses ElevenLabs via the server when
 * available, falls back to browser SpeechSynthesis otherwise.
 *
 * - Queues announcements so they never overlap.
 * - Caches audio blobs client-side so repeated phrases are instant.
 * - Reports isSpeaking state for UI indicators.
 */
export function useModeratorVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const blobCacheRef = useRef(new Map<string, string>()); // text → objectURL

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
      window.speechSynthesis.cancel();
    };
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

  // Fallback: browser SpeechSynthesis.
  const playBrowserTts = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) { resolve(); return; }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.name.includes("Google") || v.name.includes("Microsoft") || v.lang.startsWith("en")
      );
      if (preferred) utterance.voice = preferred;

      setIsSpeaking(true);
      utterance.onend = () => { setIsSpeaking(false); resolve(); };
      utterance.onerror = () => { setIsSpeaking(false); resolve(); };
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  // Process the announcement queue one item at a time.
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift()!;

      // Try ElevenLabs first if available.
      if (elevenLabsAvailable) {
        try {
          // Check if we already have it cached client-side.
          if (blobCacheRef.current.has(text)) {
            await playAudio(null, text);
            continue;
          }
          const result = await generateTts.mutateAsync({ text });
          if (result.audio) {
            await playAudio(result.audio, text);
            continue;
          }
        } catch {
          // ElevenLabs failed — fall through to browser TTS.
        }
      }

      await playBrowserTts(text);
    }

    processingRef.current = false;
  }, [elevenLabsAvailable, generateTts, playAudio, playBrowserTts]);

  // Public API: enqueue an announcement.
  const speak = useCallback(
    (text: string) => {
      queueRef.current.push(text);
      processQueue();
    },
    [processQueue]
  );

  return { speak, isSpeaking };
}
