import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

async function assertRoomParticipant(roomId: number, userId: number) {
  const participant = await db.getParticipantWithUser(roomId, userId);
  if (!participant) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not in this room",
    });
  }
  return participant;
}

export const transcriptRouter = router({
  // Get all transcript segments for a room (for initial load / rehydration)
  getAll: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertRoomParticipant(input.roomId, ctx.user.id);
      const segments = await db.getRoomTranscriptSegments(input.roomId);
      return { segments };
    }),

  // Poll for new segments since a given sequence number
  poll: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      afterSequence: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      await assertRoomParticipant(input.roomId, ctx.user.id);
      const segments = await db.getRoomTranscriptSegments(input.roomId, input.afterSequence);
      return { segments };
    }),

  // Get the latest sequence number (for checking if there are updates)
  getLatestSequence: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertRoomParticipant(input.roomId, ctx.user.id);
      const sequence = await db.getLatestTranscriptSequence(input.roomId);
      return { sequence };
    }),
});
