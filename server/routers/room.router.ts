import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { generateRoomCode, ASIAN_PARLIAMENTARY_FORMAT } from "@shared/debate";

export const roomRouter = router({
  create: protectedProcedure
    .input(z.object({
      format: z.enum(["asian_parliamentary"]).default("asian_parliamentary"),
    }))
    .mutation(async ({ ctx, input }) => {
      const roomCode = generateRoomCode();
      const roomId = await db.createDebateRoom({
        roomCode,
        creatorId: ctx.user.id,
        format: input.format,
        status: "waiting",
        currentPhase: "setup",
      });
      return { roomId, roomCode };
    }),

  join: protectedProcedure
    .input(z.object({
      roomCode: z.string().length(6),
      team: z.enum(["government", "opposition"]),
      speakerRole: z.enum([
        "prime_minister",
        "deputy_prime_minister",
        "government_whip",
        "leader_of_opposition",
        "deputy_leader_of_opposition",
        "opposition_whip"
      ]),
    }))
    .mutation(async ({ ctx, input }) => {
      const room = await db.getDebateRoomByCode(input.roomCode);
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.status !== "waiting") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Room is not accepting participants" });
      }

      const existing = await db.getParticipantWithUser(room.id, ctx.user.id);
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You are already in this room" });
      }

      const participants = await db.getRoomParticipants(room.id);
      const roleTaken = participants.some(p => p.speakerRole === input.speakerRole);
      if (roleTaken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This speaker role is already taken" });
      }

      const govRoles = ["prime_minister", "deputy_prime_minister", "government_whip"];
      const oppRoles = ["leader_of_opposition", "deputy_leader_of_opposition", "opposition_whip"];
      if (input.team === "government" && !govRoles.includes(input.speakerRole)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid role for Government team" });
      }
      if (input.team === "opposition" && !oppRoles.includes(input.speakerRole)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid role for Opposition team" });
      }

      await db.addParticipant({
        roomId: room.id,
        userId: ctx.user.id,
        team: input.team,
        speakerRole: input.speakerRole,
        isReady: false,
      });

      return { success: true, roomId: room.id };
    }),

  leave: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.removeParticipant(input.roomId, ctx.user.id);
      return { success: true };
    }),

  get: protectedProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input }) => {
      const room = await db.getDebateRoomByCode(input.roomCode);
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      const participants = await db.getRoomParticipants(room.id);
      const motion = room.motionId ? await db.getMotionById(room.motionId) : null;

      const participantsWithUsers = await Promise.all(
        participants.map(async (p) => {
          const user = await db.getUserById(p.userId);
          return { ...p, user };
        })
      );

      return { room, participants: participantsWithUsers, motion };
    }),

  getById: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .query(async ({ input }) => {
      const room = await db.getDebateRoomById(input.roomId);
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      const participants = await db.getRoomParticipants(room.id);
      const motion = room.motionId ? await db.getMotionById(room.motionId) : null;

      const participantsWithUsers = await Promise.all(
        participants.map(async (p) => {
          const user = await db.getUserById(p.userId);
          return { ...p, user };
        })
      );

      return { room, participants: participantsWithUsers, motion };
    }),

  setReady: protectedProcedure
    .input(z.object({ roomId: z.number(), isReady: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const participant = await db.getParticipantWithUser(input.roomId, ctx.user.id);
      if (!participant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "You are not in this room" });
      }
      await db.updateParticipantReady(participant.id, input.isReady);
      return { success: true };
    }),

  listActive: protectedProcedure.query(async () => {
    return await db.getActiveRooms();
  }),

  start: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const room = await db.getDebateRoomById(input.roomId);
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.creatorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the room creator can start the debate" });
      }
      if (!room.motionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A motion must be set before starting" });
      }

      const participants = await db.getRoomParticipants(room.id);
      if (participants.length < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "At least one participant must join before starting" });
      }

      const allReady = participants.every(p => p.isReady);
      if (!allReady) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "All participants must be ready" });
      }

      const participantRoles = new Set(participants.map(p => p.speakerRole));
      const fullSpeakingOrder = ASIAN_PARLIAMENTARY_FORMAT.speakingOrder;
      let firstSpeakerIndex = 0;

      for (let i = 0; i < fullSpeakingOrder.length; i++) {
        const speaker = fullSpeakingOrder[i];
        const role = speaker.role;
        if (role === "opposition_reply") {
          if (participantRoles.has("leader_of_opposition")) {
            firstSpeakerIndex = i;
            break;
          }
          continue;
        }
        if (role === "government_reply") {
          if (participantRoles.has("prime_minister")) {
            firstSpeakerIndex = i;
            break;
          }
          continue;
        }
        if (participantRoles.has(role as typeof participants[number]["speakerRole"])) {
          firstSpeakerIndex = i;
          break;
        }
      }

      await db.updateDebateRoom(input.roomId, {
        status: "in_progress",
        currentPhase: "debate",
        currentSpeakerIndex: firstSpeakerIndex,
        startedAt: new Date(),
      });

      return { success: true };
    }),

  advanceSpeaker: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const room = await db.getDebateRoomById(input.roomId);
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }

      const participants = await db.getRoomParticipants(room.id);
      const isParticipant = participants.some(p => p.userId === ctx.user.id);
      if (!isParticipant) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a participant in this room" });
      }
      const participantRoles = new Set(participants.map(p => p.speakerRole));

      const fullSpeakingOrder = ASIAN_PARLIAMENTARY_FORMAT.speakingOrder;
      const activeSpeakingOrder = fullSpeakingOrder.filter(speaker => {
        if (speaker.role === "opposition_reply") {
          return participantRoles.has("leader_of_opposition");
        }
        if (speaker.role === "government_reply") {
          return participantRoles.has("prime_minister");
        }
        return participantRoles.has(speaker.role);
      });

      const currentSpeaker = fullSpeakingOrder[room.currentSpeakerIndex || 0];
      const currentActiveIndex = activeSpeakingOrder.findIndex(s => s.role === currentSpeaker?.role);
      const nextActiveIndex = currentActiveIndex + 1;

      if (nextActiveIndex >= activeSpeakingOrder.length) {
        await db.updateDebateRoom(input.roomId, {
          currentPhase: "feedback",
          status: "completed",
          endedAt: new Date(),
        });
        return { completed: true, nextSpeakerIndex: null };
      }

      const nextSpeaker = activeSpeakingOrder[nextActiveIndex];
      const nextFullIndex = fullSpeakingOrder.findIndex(s => s.role === nextSpeaker.role);

      await db.updateDebateRoom(input.roomId, { currentSpeakerIndex: nextFullIndex });
      return { completed: false, nextSpeakerIndex: nextFullIndex };
    }),
});
