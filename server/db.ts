import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users, 
  debateRooms, InsertDebateRoom, DebateRoom,
  debateParticipants, InsertDebateParticipant,
  debateMotions, InsertDebateMotion,
  debateSpeeches, InsertDebateSpeech,
  pointsOfInformation, InsertPointOfInformation,
  argumentNodes, InsertArgumentNode,
  debateFeedback, InsertDebateFeedback,
  ruleViolations, InsertRuleViolation,
  transcriptSegments, InsertTranscriptSegment
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USER OPERATIONS ============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserProfile(userId: number, profile: {
  bio?: string;
  experienceLevel?: "novice" | "intermediate" | "advanced" | "expert";
  topicalInterests?: string[];
  background?: string;
  name?: string;
}) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(users)
    .set({ 
      ...profile, 
      profileCompleted: true,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId));
}

export async function incrementUserDebates(userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(users)
    .set({ debatesCompleted: sql`${users.debatesCompleted} + 1` })
    .where(eq(users.id, userId));
}

// ============ DEBATE ROOM OPERATIONS ============

export async function createDebateRoom(room: InsertDebateRoom) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(debateRooms).values(room);
  return result[0].insertId;
}

export async function getDebateRoomByCode(roomCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(debateRooms).where(eq(debateRooms.roomCode, roomCode)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDebateRoomById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(debateRooms).where(eq(debateRooms.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateDebateRoom(roomId: number, updates: Partial<DebateRoom>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(debateRooms).set(updates).where(eq(debateRooms.id, roomId));
}

export async function getActiveRooms() {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(debateRooms)
    .where(eq(debateRooms.status, "waiting"))
    .orderBy(desc(debateRooms.createdAt))
    .limit(20);
}

export async function getUserDebateHistory(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const participations = await db.select()
    .from(debateParticipants)
    .where(eq(debateParticipants.userId, userId));
  
  if (participations.length === 0) return [];
  
  const roomIds = participations.map(p => p.roomId);
  const rooms = await db.select()
    .from(debateRooms)
    .where(sql`${debateRooms.id} IN (${sql.join(roomIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(desc(debateRooms.createdAt));
  
  return rooms;
}

// ============ PARTICIPANT OPERATIONS ============

export async function addParticipant(participant: InsertDebateParticipant) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(debateParticipants).values(participant);
  return result[0].insertId;
}

export async function getRoomParticipants(roomId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(debateParticipants)
    .where(eq(debateParticipants.roomId, roomId));
}

export async function getParticipantWithUser(roomId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select()
    .from(debateParticipants)
    .where(and(
      eq(debateParticipants.roomId, roomId),
      eq(debateParticipants.userId, userId)
    ))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function updateParticipantReady(participantId: number, isReady: boolean) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(debateParticipants)
    .set({ isReady })
    .where(eq(debateParticipants.id, participantId));
}

export async function removeParticipant(roomId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(debateParticipants)
    .where(and(
      eq(debateParticipants.roomId, roomId),
      eq(debateParticipants.userId, userId)
    ));
}

// ============ MOTION OPERATIONS ============

export async function createMotion(motion: InsertDebateMotion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(debateMotions).values(motion);
  return result[0].insertId;
}

export async function getMotionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(debateMotions).where(eq(debateMotions.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getMotionsByTopic(topicArea: string) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(debateMotions)
    .where(eq(debateMotions.topicArea, topicArea as any))
    .orderBy(desc(debateMotions.createdAt))
    .limit(10);
}

// ============ SPEECH OPERATIONS ============

export async function createSpeech(speech: InsertDebateSpeech) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(debateSpeeches).values(speech);
  return result[0].insertId;
}

export async function updateSpeech(speechId: number, updates: Partial<InsertDebateSpeech>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(debateSpeeches).set(updates).where(eq(debateSpeeches.id, speechId));
}

export async function getRoomSpeeches(roomId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(debateSpeeches)
    .where(eq(debateSpeeches.roomId, roomId))
    .orderBy(debateSpeeches.startedAt);
}

export async function getSpeechById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(debateSpeeches).where(eq(debateSpeeches.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ POI OPERATIONS ============

export async function createPOI(poi: InsertPointOfInformation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(pointsOfInformation).values(poi);
  return result[0].insertId;
}

export async function updatePOI(poiId: number, updates: Partial<InsertPointOfInformation>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(pointsOfInformation).set(updates).where(eq(pointsOfInformation.id, poiId));
}

export async function getSpeechPOIs(speechId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(pointsOfInformation)
    .where(eq(pointsOfInformation.speechId, speechId));
}

// ============ ARGUMENT NODE OPERATIONS ============

export async function createArgumentNode(node: InsertArgumentNode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(argumentNodes).values(node);
  return result[0].insertId;
}

export async function getRoomArgumentNodes(roomId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(argumentNodes)
    .where(eq(argumentNodes.roomId, roomId))
    .orderBy(argumentNodes.createdAt);
}

export async function updateArgumentNode(nodeId: number, updates: Partial<InsertArgumentNode>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(argumentNodes).set(updates).where(eq(argumentNodes.id, nodeId));
}

// ============ FEEDBACK OPERATIONS ============

export async function createFeedback(feedback: InsertDebateFeedback) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(debateFeedback).values(feedback);
  return result[0].insertId;
}

export async function getRoomFeedback(roomId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(debateFeedback)
    .where(eq(debateFeedback.roomId, roomId));
}

export async function getParticipantFeedback(roomId: number, participantId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select()
    .from(debateFeedback)
    .where(and(
      eq(debateFeedback.roomId, roomId),
      eq(debateFeedback.participantId, participantId)
    ))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

// ============ RULE VIOLATION OPERATIONS ============

export async function createRuleViolation(violation: InsertRuleViolation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(ruleViolations).values(violation);
  return result[0].insertId;
}

export async function getRoomViolations(roomId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select()
    .from(ruleViolations)
    .where(eq(ruleViolations.roomId, roomId))
    .orderBy(ruleViolations.createdAt);
}

// ============ TRANSCRIPT SEGMENT OPERATIONS ============

export async function createTranscriptSegment(segment: InsertTranscriptSegment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(transcriptSegments).values(segment);
  return result[0].insertId;
}

export async function getRoomTranscriptSegments(roomId: number, afterSequence?: number) {
  const db = await getDb();
  if (!db) return [];
  
  if (afterSequence !== undefined) {
    return await db.select()
      .from(transcriptSegments)
      .where(and(
        eq(transcriptSegments.roomId, roomId),
        sql`${transcriptSegments.sequenceNumber} > ${afterSequence}`
      ))
      .orderBy(transcriptSegments.sequenceNumber);
  }
  
  return await db.select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.roomId, roomId))
    .orderBy(transcriptSegments.sequenceNumber);
}

export async function getLatestTranscriptSequence(roomId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ maxSeq: sql<number>`COALESCE(MAX(${transcriptSegments.sequenceNumber}), 0)` })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.roomId, roomId));
  
  return result[0]?.maxSeq || 0;
}

export async function deleteRoomTranscriptSegments(roomId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(transcriptSegments)
    .where(eq(transcriptSegments.roomId, roomId));
}
