import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const feedbackRouter = router({
  generate: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .mutation(async ({ input }) => {
      // Idempotency: if feedback already exists, return it instead of regenerating.
      const existingFeedback = await db.getRoomFeedback(input.roomId);
      if (existingFeedback.length > 0) {
        const overall = existingFeedback.find(f => f.feedbackType === "overall");
        return {
          overallAnalysis: overall?.overallAnalysis ?? "",
          suggestedWinner: overall?.suggestedWinner ?? "government",
          winningReason: overall?.winningReason ?? "",
          teamFeedback: existingFeedback
            .filter(f => f.feedbackType === "team")
            .map(f => ({ team: f.team, strongestArguments: f.strongestArguments, missedResponses: f.missedResponses, improvements: f.improvements })),
          individualFeedback: existingFeedback
            .filter(f => f.feedbackType === "individual")
            .map(f => ({ speakerRole: "", strongestArguments: f.strongestArguments, missedResponses: f.missedResponses, improvements: f.improvements })),
        };
      }

      const speeches = await db.getRoomSpeeches(input.roomId);
      const room = await db.getDebateRoomById(input.roomId);
      const motion = room?.motionId ? await db.getMotionById(room.motionId) : null;
      const participants = await db.getRoomParticipants(input.roomId);
      const argumentNodes = await db.getRoomArgumentNodes(input.roomId);

      const transcripts = speeches
        .filter(s => s.transcript)
        .map(s => `[${s.speakerRole}]: ${s.transcript}`)
        .join("\n\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert debate coach providing detailed feedback after a competitive debate. Analyze the debate and provide:

1. Overall analysis including the likely winner and why
2. Team-level feedback for both Government and Opposition
3. Individual feedback for each speaker

For each piece of feedback, identify:
- Strongest arguments made
- Missed opportunities to respond
- Specific suggestions for improvement

Return a JSON object with:
- overallAnalysis: String with debate summary
- suggestedWinner: "government" or "opposition"
- winningReason: Why this team won
- teamFeedback: Array with feedback for each team
- individualFeedback: Array with feedback for each speaker role`
          },
          {
            role: "user",
            content: `Motion: ${motion?.motion || "Unknown"}\n\nTranscript:\n${transcripts}\n\nArgument Analysis:\n${JSON.stringify(argumentNodes.slice(0, 20))}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "debate_feedback",
            strict: true,
            schema: {
              type: "object",
              properties: {
                overallAnalysis: { type: "string" },
                suggestedWinner: { type: "string", enum: ["government", "opposition"] },
                winningReason: { type: "string" },
                teamFeedback: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      team: { type: "string", enum: ["government", "opposition"] },
                      strongestArguments: { type: "array", items: { type: "string" } },
                      missedResponses: { type: "array", items: { type: "string" } },
                      improvements: { type: "array", items: { type: "string" } }
                    },
                    required: ["team", "strongestArguments", "missedResponses", "improvements"],
                    additionalProperties: false
                  }
                },
                individualFeedback: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      speakerRole: { type: "string" },
                      strongestArguments: { type: "array", items: { type: "string" } },
                      missedResponses: { type: "array", items: { type: "string" } },
                      improvements: { type: "array", items: { type: "string" } }
                    },
                    required: ["speakerRole", "strongestArguments", "missedResponses", "improvements"],
                    additionalProperties: false
                  }
                }
              },
              required: ["overallAnalysis", "suggestedWinner", "winningReason", "teamFeedback", "individualFeedback"],
              additionalProperties: false
            }
          }
        }
      });

      const content = response.choices[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate feedback" });
      }

      let feedbackData: {
        overallAnalysis: string;
        suggestedWinner: "government" | "opposition";
        winningReason: string;
        teamFeedback: Array<{ team: "government" | "opposition"; strongestArguments: string[]; missedResponses: string[]; improvements: string[] }>;
        individualFeedback: Array<{ speakerRole: string; strongestArguments: string[]; missedResponses: string[]; improvements: string[] }>;
      };
      try {
        feedbackData = JSON.parse(content);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "LLM returned invalid JSON for feedback generation",
        });
      }

      await db.createFeedback({
        roomId: input.roomId,
        feedbackType: "overall",
        overallAnalysis: feedbackData.overallAnalysis,
        suggestedWinner: feedbackData.suggestedWinner,
        winningReason: feedbackData.winningReason,
      });

      for (const teamFb of feedbackData.teamFeedback) {
        await db.createFeedback({
          roomId: input.roomId,
          feedbackType: "team",
          team: teamFb.team,
          strongestArguments: teamFb.strongestArguments,
          missedResponses: teamFb.missedResponses,
          improvements: teamFb.improvements,
        });
      }

      for (const indFb of feedbackData.individualFeedback) {
        const participant = participants.find(p => p.speakerRole === indFb.speakerRole);
        if (participant) {
          await db.createFeedback({
            roomId: input.roomId,
            feedbackType: "individual",
            participantId: participant.id,
            strongestArguments: indFb.strongestArguments,
            missedResponses: indFb.missedResponses,
            improvements: indFb.improvements,
          });
        }
      }

      await db.updateDebateRoom(input.roomId, { currentPhase: "completed" });

      for (const p of participants) {
        await db.incrementUserDebates(p.userId);
      }

      return feedbackData;
    }),

  get: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      return await db.getRoomFeedback(input.roomId);
    }),
});
