import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
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
      const { transcribeBuffer } = await import('../_core/transcribeBuffer');

      const audioBuffer = Buffer.from(input.audioData, 'base64');

      if (audioBuffer.length < 1000) {
        console.log('[Transcription] Audio too small:', audioBuffer.length, 'bytes');
        return {
          transcript: '',
          segments: [],
        };
      }

      console.log('[Transcription] Processing audio directly:', audioBuffer.length, 'bytes');

      const result = await transcribeBuffer({
        audioBuffer,
        mimeType: 'audio/webm',
        language: 'en',
        prompt: 'Transcribe this debate speech clearly and accurately.',
      });

      if ('error' in result) {
        console.error('[Transcription] Error:', result.error, result.details);
        return {
          transcript: '',
          segments: [],
        };
      }

      const speech = await db.getSpeechById(input.speechId);
      if (!speech) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Speech not found" });
      }

      const existingTranscript = speech.transcript || '';
      const newTranscript = existingTranscript
        ? `${existingTranscript} ${result.text}`
        : result.text;

      await db.updateSpeech(input.speechId, {
        transcript: newTranscript,
      });

      const latestSeq = await db.getLatestTranscriptSequence(speech.roomId);
      await db.createTranscriptSegment({
        roomId: speech.roomId,
        speechId: input.speechId,
        speakerRole: speech.speakerRole,
        speakerName: null,
        text: result.text,
        timestamp: input.timestamp || 0,
        sequenceNumber: latestSeq + 1,
      });

      return {
        transcript: result.text,
        segments: result.segments,
        sequenceNumber: latestSeq + 1,
      };
    }),
});
