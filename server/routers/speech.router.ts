import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  createScribeSingleUseToken,
  SCRIBE_MODEL_ID,
} from "../_core/scribeToken";

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
    .query(async ({ ctx, input }) => {
      const participant = await db.getParticipantWithUser(input.roomId, ctx.user.id);
      if (!participant) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not in this room" });
      }
      return await db.getRoomSpeeches(input.roomId);
    }),

  // Mint a short-lived, single-use ElevenLabs Scribe Realtime token.
  //
  // The browser never sees ELEVENLABS_API_KEY: it asks the server for a
  // 15-minute single-use token bound to the active speech, then opens the
  // Scribe Realtime WebSocket directly with that token.
  createScribeToken: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      speechId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const speech = await db.getSpeechById(input.speechId);
      if (!speech) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Speech not found" });
      }
      if (speech.roomId !== input.roomId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Speech does not belong to this room",
        });
      }
      const participant = await db.getParticipantWithUser(speech.roomId, ctx.user.id);
      if (!participant || participant.id !== speech.participantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only transcribe your own speech",
        });
      }

      const result = await createScribeSingleUseToken();
      if ("error" in result) {
        // Surface configuration / upstream failures explicitly — never
        // silently degrade to "no transcription".
        throw new TRPCError({
          code:
            result.code === "NOT_CONFIGURED"
              ? "PRECONDITION_FAILED"
              : "INTERNAL_SERVER_ERROR",
          message: result.error,
          cause: result.details,
        });
      }

      return { token: result.token, modelId: SCRIBE_MODEL_ID };
    }),

  // Persist a finalized Scribe transcript segment for the active speech.
  //
  // Idempotency note: transcript_segments has no client-supplied id column,
  // so true cross-request dedupe would require a schema change (out of scope
  // for this phase). As a best-effort guard we drop a segment that exactly
  // matches the most recent stored segment for the same speech + timestamp,
  // which absorbs accidental double-sends / network retries. clientSegmentId
  // is accepted for forward-compatibility but not yet persisted.
  commitTranscriptSegment: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      speechId: z.number(),
      text: z.string(),
      timestamp: z.number().optional(),
      clientSegmentId: z.string().optional(),
      isFinal: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const speech = await db.getSpeechById(input.speechId);
      if (!speech) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Speech not found" });
      }
      if (speech.roomId !== input.roomId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Speech does not belong to this room",
        });
      }
      const participant = await db.getParticipantWithUser(speech.roomId, ctx.user.id);
      if (!participant || participant.id !== speech.participantId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only commit transcript for your own speech",
        });
      }

      const text = input.text.trim();
      if (!text) {
        return { committed: false as const, reason: "empty" as const };
      }

      const timestamp = input.timestamp ?? 0;

      // Best-effort idempotency: skip if this exactly duplicates the most
      // recent segment already stored for this speech at this timestamp.
      const existingSegments = await db.getRoomTranscriptSegments(speech.roomId);
      const lastForSpeech = existingSegments
        .filter((s) => s.speechId === input.speechId)
        .at(-1);
      if (
        lastForSpeech &&
        lastForSpeech.text === text &&
        lastForSpeech.timestamp === timestamp
      ) {
        return {
          committed: false as const,
          reason: "duplicate" as const,
          sequenceNumber: lastForSpeech.sequenceNumber,
        };
      }

      const existingTranscript = speech.transcript || "";
      const newTranscript = existingTranscript
        ? `${existingTranscript} ${text}`
        : text;
      await db.updateSpeech(input.speechId, { transcript: newTranscript });

      const latestSeq = await db.getLatestTranscriptSequence(speech.roomId);
      const sequenceNumber = latestSeq + 1;
      await db.createTranscriptSegment({
        roomId: speech.roomId,
        speechId: input.speechId,
        speakerRole: speech.speakerRole,
        speakerName: null,
        text,
        timestamp,
        sequenceNumber,
      });

      return { committed: true as const, sequenceNumber };
    }),
});
