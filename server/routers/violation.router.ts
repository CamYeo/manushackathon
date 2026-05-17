import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const violationRouter = router({
  report: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      speechId: z.number().optional(),
      violationType: z.enum(["time_exceeded", "new_argument_in_reply", "poi_outside_window", "speaking_out_of_turn"]),
      description: z.string().optional(),
      timestamp: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const participant = await db.getParticipantWithUser(input.roomId, ctx.user.id);
      if (!participant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "You are not in this room" });
      }

      await db.createRuleViolation({
        roomId: input.roomId,
        speechId: input.speechId,
        participantId: participant.id,
        violationType: input.violationType,
        description: input.description,
        timestamp: input.timestamp,
      });

      return { success: true };
    }),

  getAll: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      return await db.getRoomViolations(input.roomId);
    }),
});
