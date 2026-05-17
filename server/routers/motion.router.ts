import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { TOPIC_AREAS, DIFFICULTY_LEVELS } from "@shared/debate";

export const motionRouter = router({
  generate: protectedProcedure
    .input(z.object({
      topicArea: z.enum(["politics", "ethics", "technology", "economics", "social", "environment", "education", "health"]),
      difficulty: z.enum(["novice", "intermediate", "advanced"]),
      roomId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const topicLabel = TOPIC_AREAS.find(t => t.id === input.topicArea)?.label || input.topicArea;
      const diffLabel = DIFFICULTY_LEVELS.find(d => d.id === input.difficulty)?.label || input.difficulty;

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert debate coach who creates debate motions for competitive debating in Asian Parliamentary format. Generate motions that are:
- Clear and debatable with strong arguments on both sides
- Appropriate for the specified difficulty level
- Relevant to current issues in the topic area
- Formatted as "This House..." statements

Respond with a JSON object containing:
- motion: The debate motion starting with "This House..."
- backgroundContext: A brief 2-3 sentence explanation of the issue
- keyStakeholders: An array of 3-5 key stakeholders affected by this motion`
          },
          {
            role: "user",
            content: `Generate a ${diffLabel} level debate motion about ${topicLabel}.`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "debate_motion",
            strict: true,
            schema: {
              type: "object",
              properties: {
                motion: { type: "string", description: "The debate motion" },
                backgroundContext: { type: "string", description: "Brief context about the issue" },
                keyStakeholders: {
                  type: "array",
                  items: { type: "string" },
                  description: "Key stakeholders affected"
                }
              },
              required: ["motion", "backgroundContext", "keyStakeholders"],
              additionalProperties: false
            }
          }
        }
      });

      const content = response.choices[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate motion" });
      }

      let motionData: { motion: string; backgroundContext: string; keyStakeholders: string[] };
      try {
        motionData = JSON.parse(content);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "LLM returned invalid JSON for motion generation",
        });
      }

      const motionId = await db.createMotion({
        motion: motionData.motion,
        topicArea: input.topicArea,
        difficulty: input.difficulty,
        backgroundContext: motionData.backgroundContext,
        keyStakeholders: motionData.keyStakeholders,
        isAiGenerated: true,
      });

      await db.updateDebateRoom(input.roomId, { motionId });

      return {
        motionId,
        motion: motionData.motion,
        backgroundContext: motionData.backgroundContext,
        keyStakeholders: motionData.keyStakeholders
      };
    }),

  get: protectedProcedure
    .input(z.object({ motionId: z.number() }))
    .query(async ({ input }) => {
      return await db.getMotionById(input.motionId);
    }),
});
