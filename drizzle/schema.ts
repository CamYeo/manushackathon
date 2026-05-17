import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, boolean } from "drizzle-orm/mysql-core";

// User table with debate-specific profile fields
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  // Debate-specific profile fields
  bio: text("bio"),
  experienceLevel: mysqlEnum("experienceLevel", ["novice", "intermediate", "advanced", "expert"]).default("novice"),
  topicalInterests: json("topicalInterests").$type<string[]>(),
  background: text("background"),
  debatesCompleted: int("debatesCompleted").default(0),
  profileCompleted: boolean("profileCompleted").default(false),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Debate rooms
export const debateRooms = mysqlTable("debate_rooms", {
  id: int("id").autoincrement().primaryKey(),
  roomCode: varchar("roomCode", { length: 8 }).notNull().unique(),
  creatorId: int("creatorId").notNull(),
  motionId: int("motionId"),
  status: mysqlEnum("status", ["waiting", "in_progress", "completed", "cancelled"]).default("waiting").notNull(),
  format: mysqlEnum("format", ["asian_parliamentary"]).default("asian_parliamentary").notNull(),
  currentSpeakerIndex: int("currentSpeakerIndex").default(0),
  currentPhase: mysqlEnum("currentPhase", ["setup", "debate", "feedback", "completed"]).default("setup").notNull(),
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DebateRoom = typeof debateRooms.$inferSelect;
export type InsertDebateRoom = typeof debateRooms.$inferInsert;

// Debate participants (links users to rooms with team/role info)
export const debateParticipants = mysqlTable("debate_participants", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  userId: int("userId").notNull(),
  team: mysqlEnum("team", ["government", "opposition"]).notNull(),
  speakerRole: mysqlEnum("speakerRole", [
    "prime_minister",
    "deputy_prime_minister", 
    "government_whip",
    "leader_of_opposition",
    "deputy_leader_of_opposition",
    "opposition_whip"
  ]).notNull(),
  isReady: boolean("isReady").default(false),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

export type DebateParticipant = typeof debateParticipants.$inferSelect;
export type InsertDebateParticipant = typeof debateParticipants.$inferInsert;

// Debate motions (AI-generated or preset)
export const debateMotions = mysqlTable("debate_motions", {
  id: int("id").autoincrement().primaryKey(),
  motion: text("motion").notNull(),
  topicArea: mysqlEnum("topicArea", ["politics", "ethics", "technology", "economics", "social", "environment", "education", "health"]).notNull(),
  difficulty: mysqlEnum("difficulty", ["novice", "intermediate", "advanced"]).default("intermediate").notNull(),
  backgroundContext: text("backgroundContext"),
  keyStakeholders: json("keyStakeholders").$type<string[]>(),
  isAiGenerated: boolean("isAiGenerated").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DebateMotion = typeof debateMotions.$inferSelect;
export type InsertDebateMotion = typeof debateMotions.$inferInsert;

// Debate speeches (individual speech records with transcription)
export const debateSpeeches = mysqlTable("debate_speeches", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  participantId: int("participantId").notNull(),
  speakerRole: varchar("speakerRole", { length: 64 }).notNull(),
  speechType: mysqlEnum("speechType", ["substantive", "reply"]).default("substantive").notNull(),
  transcript: text("transcript"),
  audioUrl: varchar("audioUrl", { length: 512 }),
  duration: int("duration"), // in seconds
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DebateSpeech = typeof debateSpeeches.$inferSelect;
export type InsertDebateSpeech = typeof debateSpeeches.$inferInsert;

// Points of Information (POIs)
export const pointsOfInformation = mysqlTable("points_of_information", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  speechId: int("speechId").notNull(),
  offeredById: int("offeredById").notNull(),
  accepted: boolean("accepted").default(false),
  content: text("content"),
  timestamp: int("timestamp"), // seconds into the speech
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PointOfInformation = typeof pointsOfInformation.$inferSelect;
export type InsertPointOfInformation = typeof pointsOfInformation.$inferInsert;

// Argument nodes for mindmap
export const argumentNodes = mysqlTable("argument_nodes", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  speechId: int("speechId"),
  parentId: int("parentId"),
  team: mysqlEnum("team", ["government", "opposition"]).notNull(),
  nodeType: mysqlEnum("nodeType", ["argument", "rebuttal", "extension", "summary"]).notNull(),
  content: text("content").notNull(),
  transcriptSegment: text("transcriptSegment"),
  transcriptTimestamp: int("transcriptTimestamp"),
  qualityScore: int("qualityScore"), // 1-10
  qualityExplanation: text("qualityExplanation"),
  wasAnswered: boolean("wasAnswered").default(false),
  answeredById: int("answeredById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ArgumentNode = typeof argumentNodes.$inferSelect;
export type InsertArgumentNode = typeof argumentNodes.$inferInsert;

// Post-debate feedback
export const debateFeedback = mysqlTable("debate_feedback", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  participantId: int("participantId"),
  feedbackType: mysqlEnum("feedbackType", ["individual", "team", "overall"]).notNull(),
  team: mysqlEnum("team", ["government", "opposition"]),
  strongestArguments: json("strongestArguments").$type<string[]>(),
  missedResponses: json("missedResponses").$type<string[]>(),
  improvements: json("improvements").$type<string[]>(),
  overallAnalysis: text("overallAnalysis"),
  suggestedWinner: mysqlEnum("suggestedWinner", ["government", "opposition"]),
  winningReason: text("winningReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DebateFeedback = typeof debateFeedback.$inferSelect;
export type InsertDebateFeedback = typeof debateFeedback.$inferInsert;

// Live transcript segments for real-time syncing
export const transcriptSegments = mysqlTable("transcript_segments", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  speechId: int("speechId").notNull(),
  speakerRole: varchar("speakerRole", { length: 64 }).notNull(),
  speakerName: varchar("speakerName", { length: 255 }),
  text: text("text").notNull(),
  timestamp: int("timestamp").notNull(), // seconds into the speech
  sequenceNumber: int("sequenceNumber").notNull(), // for ordering
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type InsertTranscriptSegment = typeof transcriptSegments.$inferInsert;

// Rule violations flagged during debate
export const ruleViolations = mysqlTable("rule_violations", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  speechId: int("speechId"),
  participantId: int("participantId").notNull(),
  violationType: mysqlEnum("violationType", [
    "time_exceeded",
    "new_argument_in_reply",
    "poi_outside_window",
    "speaking_out_of_turn"
  ]).notNull(),
  description: text("description"),
  timestamp: int("timestamp"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RuleViolation = typeof ruleViolations.$inferSelect;
export type InsertRuleViolation = typeof ruleViolations.$inferInsert;
