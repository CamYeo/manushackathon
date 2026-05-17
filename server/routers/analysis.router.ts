import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const analysisRouter = router({
  generateMindmap: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .mutation(async ({ input }) => {
      // Idempotency: if argument nodes already exist, return count instead of regenerating.
      const existingNodes = await db.getRoomArgumentNodes(input.roomId);
      if (existingNodes.length > 0) {
        return { success: true, nodeCount: existingNodes.length };
      }

      const speeches = await db.getRoomSpeeches(input.roomId);
      const room = await db.getDebateRoomById(input.roomId);
      const motion = room?.motionId ? await db.getMotionById(room.motionId) : null;

      if (speeches.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No speeches to analyze" });
      }

      const transcripts = speeches
        .filter(s => s.transcript)
        .map(s => `[${s.speakerRole}]: ${s.transcript}`)
        .join("\n\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert debate analyst. Analyze the debate transcript and extract key arguments, rebuttals, and their relationships.

For each argument or rebuttal, provide:
- team: "government" or "opposition"
- nodeType: "argument", "rebuttal", "extension", or "summary"
- content: A concise summary of the point (1-2 sentences)
- transcriptSegment: The relevant quote from the transcript
- qualityScore: 1-10 rating of argument quality
- qualityExplanation: Brief explanation of the score
- wasAnswered: Whether this point was addressed by the opposing team
- parentContent: If this is a rebuttal, the content of the argument it responds to (null otherwise)

Return a JSON object with an "arguments" array containing these nodes.`
          },
          {
            role: "user",
            content: `Motion: ${motion?.motion || "Unknown"}\n\nTranscript:\n${transcripts}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "argument_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                arguments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      team: { type: "string", enum: ["government", "opposition"] },
                      nodeType: { type: "string", enum: ["argument", "rebuttal", "extension", "summary"] },
                      content: { type: "string" },
                      transcriptSegment: { type: "string" },
                      qualityScore: { type: "integer" },
                      qualityExplanation: { type: "string" },
                      wasAnswered: { type: "boolean" },
                      parentContent: { type: ["string", "null"] }
                    },
                    required: ["team", "nodeType", "content", "transcriptSegment", "qualityScore", "qualityExplanation", "wasAnswered", "parentContent"],
                    additionalProperties: false
                  }
                }
              },
              required: ["arguments"],
              additionalProperties: false
            }
          }
        }
      });

      const content = response.choices[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to analyze debate" });
      }

      let analysisData: { arguments: Array<{ team: "government" | "opposition"; nodeType: "argument" | "rebuttal" | "extension" | "summary"; content: string; transcriptSegment: string; qualityScore: number; qualityExplanation: string; wasAnswered: boolean; parentContent: string | null }> };
      try {
        analysisData = JSON.parse(content);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "LLM returned invalid JSON for argument analysis",
        });
      }

      const nodeIds: number[] = [];
      const nodeMap = new Map<string, number>();

      for (const arg of analysisData.arguments) {
        const parentId = arg.parentContent ? nodeMap.get(arg.parentContent) : null;

        const nodeId = await db.createArgumentNode({
          roomId: input.roomId,
          team: arg.team,
          nodeType: arg.nodeType,
          content: arg.content,
          transcriptSegment: arg.transcriptSegment,
          qualityScore: arg.qualityScore,
          qualityExplanation: arg.qualityExplanation,
          wasAnswered: arg.wasAnswered,
          parentId: parentId || undefined,
        });

        nodeIds.push(nodeId);
        nodeMap.set(arg.content, nodeId);
      }

      return { success: true, nodeCount: nodeIds.length };
    }),

  getArgumentNodes: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      return await db.getRoomArgumentNodes(input.roomId);
    }),
});
