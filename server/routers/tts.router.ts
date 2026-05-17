import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { generateSpeech, isElevenLabsConfigured } from "../elevenlabs";

export const ttsRouter = router({
  isAvailable: publicProcedure.query(() => isElevenLabsConfigured()),

  generate: protectedProcedure
    .input(z.object({ text: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const audio = await generateSpeech(input.text);
      if (!audio) return { audio: null };
      return { audio: audio.toString("base64") };
    }),
});
