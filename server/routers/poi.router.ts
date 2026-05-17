import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const poiRouter = router({
  offer: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      speechId: z.number(),
      timestamp: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const participant = await db.getParticipantWithUser(input.roomId, ctx.user.id);
      if (!participant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "You are not in this room" });
      }

      const poiId = await db.createPOI({
        roomId: input.roomId,
        speechId: input.speechId,
        offeredById: participant.id,
        timestamp: input.timestamp,
        accepted: false,
      });

      return { poiId };
    }),

  respond: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      poiId: z.number(),
      accepted: z.boolean(),
      content: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Only a participant in this room can respond to a POI.
      const participant = await db.getParticipantWithUser(input.roomId, ctx.user.id);
      if (!participant) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a participant in this room" });
      }

      await db.updatePOI(input.poiId, {
        accepted: input.accepted,
        content: input.content,
      });
      return { success: true };
    }),
});
