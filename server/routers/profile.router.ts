import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),

  update: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100).optional(),
      bio: z.string().max(500).optional(),
      experienceLevel: z.enum(["novice", "intermediate", "advanced", "expert"]).optional(),
      topicalInterests: z.array(z.string()).max(5).optional(),
      background: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.updateUserProfile(ctx.user.id, input);
      return { success: true };
    }),

  getDebateHistory: protectedProcedure.query(async ({ ctx }) => {
    return await db.getUserDebateHistory(ctx.user.id);
  }),
});
