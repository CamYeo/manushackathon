import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const transcriptRouter = router({
  // Get all transcript segments for a room (for initial load / rehydration)
  getAll: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      const segments = await db.getRoomTranscriptSegments(input.roomId);
      return { segments };
    }),

  // Poll for new segments since a given sequence number
  poll: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      afterSequence: z.number(),
    }))
    .query(async ({ input }) => {
      const segments = await db.getRoomTranscriptSegments(input.roomId, input.afterSequence);
      return { segments };
    }),

  // Get the latest sequence number (for checking if there are updates)
  getLatestSequence: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      const sequence = await db.getLatestTranscriptSequence(input.roomId);
      return { sequence };
    }),
});
