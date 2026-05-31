import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database module — every router db call is a controllable spy.
vi.mock("./db", () => ({
  getParticipantWithUser: vi.fn(),
  getSpeechById: vi.fn(),
  createSpeech: vi.fn().mockResolvedValue(1),
  updateSpeech: vi.fn().mockResolvedValue(undefined),
  getRoomSpeeches: vi.fn().mockResolvedValue([]),
  getRoomTranscriptSegments: vi.fn().mockResolvedValue([]),
  getLatestTranscriptSequence: vi.fn().mockResolvedValue(0),
  createTranscriptSegment: vi.fn().mockResolvedValue(1),
}));

// Mock the Scribe token minter so router tests never touch ElevenLabs.
vi.mock("./_core/scribeToken", () => ({
  SCRIBE_MODEL_ID: "scribe_v2_realtime",
  createScribeSingleUseToken: vi.fn(),
}));

// LLM is in the appRouter import graph (motion router); never invoked here.
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const ownedSpeech = {
  id: 10,
  roomId: 5,
  participantId: 100,
  speakerRole: "prime_minister",
  speechType: "substantive" as const,
  transcript: null,
  audioUrl: null,
  duration: null,
  startedAt: new Date(),
  endedAt: null,
  createdAt: new Date(),
};

const owningParticipant = {
  id: 100,
  roomId: 5,
  userId: 1,
  team: "government" as const,
  speakerRole: "prime_minister",
  isReady: true,
  joinedAt: new Date(),
};

describe("speech.createScribeToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a token + modelId for the speech owner when configured", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    const { createScribeSingleUseToken } = await import("./_core/scribeToken");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(createScribeSingleUseToken).mockResolvedValue({ token: "tok_abc" });

    const result = await caller.speech.createScribeToken({
      roomId: 5,
      speechId: 10,
    });

    expect(result).toEqual({ token: "tok_abc", modelId: "scribe_v2_realtime" });
  });

  it("maps NOT_CONFIGURED to PRECONDITION_FAILED (never silent)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    const { createScribeSingleUseToken } = await import("./_core/scribeToken");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(createScribeSingleUseToken).mockResolvedValue({
      error: "Realtime transcription is not configured",
      code: "NOT_CONFIGURED",
      details: "ELEVENLABS_API_KEY is not set on the server",
    });

    await expect(
      caller.speech.createScribeToken({ roomId: 5, speechId: 10 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps upstream REQUEST_FAILED to INTERNAL_SERVER_ERROR", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    const { createScribeSingleUseToken } = await import("./_core/scribeToken");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(createScribeSingleUseToken).mockResolvedValue({
      error: "Failed to create Scribe token",
      code: "REQUEST_FAILED",
      details: "401 Unauthorized",
    });

    await expect(
      caller.speech.createScribeToken({ roomId: 5, speechId: 10 }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects a user who does not own the speech (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ id: 2 }));
    const db = await import("./db");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue({
      ...owningParticipant,
      id: 999,
      userId: 2,
    });

    await expect(
      caller.speech.createScribeToken({ roomId: 5, speechId: 10 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when the speech is not in the given room (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);

    await expect(
      caller.speech.createScribeToken({ roomId: 999, speechId: 10 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(createUnauthContext());
    await expect(
      caller.speech.createScribeToken({ roomId: 5, speechId: 10 }),
    ).rejects.toThrow();
  });
});

describe("speech.commitTranscriptSegment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends transcript + writes a segment for the speech owner", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(db.getRoomTranscriptSegments).mockResolvedValue([]);
    vi.mocked(db.getLatestTranscriptSequence).mockResolvedValue(3);

    const result = await caller.speech.commitTranscriptSegment({
      roomId: 5,
      speechId: 10,
      text: "  Honourable speaker, we propose this motion.  ",
      timestamp: 12,
    });

    expect(result).toEqual({ committed: true, sequenceNumber: 4 });
    expect(db.updateSpeech).toHaveBeenCalledWith(10, {
      transcript: "Honourable speaker, we propose this motion.",
    });
    expect(db.createTranscriptSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 5,
        speechId: 10,
        speakerRole: "prime_minister",
        speakerName: null,
        text: "Honourable speaker, we propose this motion.",
        timestamp: 12,
        sequenceNumber: 4,
      }),
    );
  });

  it("ignores empty / whitespace-only text without writing", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);

    const result = await caller.speech.commitTranscriptSegment({
      roomId: 5,
      speechId: 10,
      text: "    ",
    });

    expect(result).toEqual({ committed: false, reason: "empty" });
    expect(db.updateSpeech).not.toHaveBeenCalled();
    expect(db.createTranscriptSegment).not.toHaveBeenCalled();
  });

  it("drops an exact duplicate of the last stored segment (best-effort idempotency)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(db.getRoomTranscriptSegments).mockResolvedValue([
      {
        id: 1,
        roomId: 5,
        speechId: 10,
        speakerRole: "prime_minister",
        speakerName: null,
        text: "Same text.",
        timestamp: 7,
        sequenceNumber: 2,
        createdAt: new Date(),
      },
    ]);

    const result = await caller.speech.commitTranscriptSegment({
      roomId: 5,
      speechId: 10,
      text: "Same text.",
      timestamp: 7,
    });

    expect(result).toEqual({
      committed: false,
      reason: "duplicate",
      sequenceNumber: 2,
    });
    expect(db.createTranscriptSegment).not.toHaveBeenCalled();
  });

  it("rejects committing for a speech the caller does not own (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext({ id: 2 }));
    const db = await import("./db");

    vi.mocked(db.getSpeechById).mockResolvedValue(ownedSpeech);
    vi.mocked(db.getParticipantWithUser).mockResolvedValue({
      ...owningParticipant,
      id: 777,
      userId: 2,
    });

    await expect(
      caller.speech.commitTranscriptSegment({
        roomId: 5,
        speechId: 10,
        text: "Trying to write to someone else's speech.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("transcript router authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects getAll for a non-participant (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(undefined);

    await expect(
      caller.transcript.getAll({ roomId: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects poll for a non-participant (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(undefined);

    await expect(
      caller.transcript.poll({ roomId: 5, afterSequence: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects getLatestSequence for a non-participant (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(undefined);

    await expect(
      caller.transcript.getLatestSequence({ roomId: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a room participant to read transcript segments", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(db.getRoomTranscriptSegments).mockResolvedValue([]);

    const result = await caller.transcript.getAll({ roomId: 5 });
    expect(result).toEqual({ segments: [] });
  });
});

describe("speech.getAll authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-participant (FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(undefined);

    await expect(
      caller.speech.getAll({ roomId: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a participant", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    const db = await import("./db");
    vi.mocked(db.getParticipantWithUser).mockResolvedValue(owningParticipant);
    vi.mocked(db.getRoomSpeeches).mockResolvedValue([]);

    const result = await caller.speech.getAll({ roomId: 5 });
    expect(result).toEqual([]);
  });
});
