import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { transcribeAudio } from "../_core/voiceTranscription";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const speechRouter = router({
  create: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      speakerRole: z.string(),
      speechType: z.enum(["substantive", "reply"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const participant = await db.getParticipantWithUser(input.roomId, ctx.user.id);
      if (!participant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "You are not in this room" });
      }

      const speechId = await db.createSpeech({
        roomId: input.roomId,
        participantId: participant.id,
        speakerRole: input.speakerRole,
        speechType: input.speechType,
        startedAt: new Date(),
      });

      return { speechId };
    }),

  updateTranscript: protectedProcedure
    .input(z.object({
      speechId: z.number(),
      transcript: z.string(),
      audioUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const speech = await db.getSpeechById(input.speechId);
      if (!speech) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Speech not found" });
      }
      const participant = await db.getParticipantWithUser(speech.roomId, ctx.user.id);
      if (!participant || participant.id !== speech.participantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only update your own speech" });
      }

      await db.updateSpeech(input.speechId, {
        transcript: input.transcript,
        audioUrl: input.audioUrl,
      });
      return { success: true };
    }),

  end: protectedProcedure
    .input(z.object({
      speechId: z.number(),
      duration: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const speech = await db.getSpeechById(input.speechId);
      if (!speech) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Speech not found" });
      }
      const participant = await db.getParticipantWithUser(speech.roomId, ctx.user.id);
      if (!participant || participant.id !== speech.participantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only end your own speech" });
      }

      await db.updateSpeech(input.speechId, {
        endedAt: new Date(),
        duration: input.duration,
      });
      return { success: true };
    }),

  getAll: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      return await db.getRoomSpeeches(input.roomId);
    }),

  transcribe: protectedProcedure
    .input(z.object({
      audioData: z.string(),
      speechId: z.number(),
      timestamp: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const audioBuffer = Buffer.from(input.audioData, 'base64');

      const { storagePut } = await import('../storage');
      const fileName = `audio/${input.speechId}/${Date.now()}.webm`;
      const { url: audioUrl } = await storagePut(fileName, audioBuffer, 'audio/webm');

      const result = await transcribeAudio({
        audioUrl,
        language: "en",
        prompt: "Transcribe this debate speech. Focus on clarity and accuracy.",
      });

      if ('error' in result) {
        console.error('Transcription error:', result.error);
        return {
          transcript: '',
          segments: [],
        };
      }

      const speech = await db.getSpeechById(input.speechId);
      const existingTranscript = speech?.transcript || '';
      const newTranscript = existingTranscript
        ? `${existingTranscript} ${result.text}`
        : result.text;

      await db.updateSpeech(input.speechId, {
        transcript: newTranscript,
        audioUrl,
      });

      return {
        transcript: result.text,
        segments: result.segments,
      };
    }),
});
