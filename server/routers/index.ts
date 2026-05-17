import { systemRouter } from "../_core/systemRouter";
import { router } from "../_core/trpc";
import { authRouter } from "./auth.router";
import { profileRouter } from "./profile.router";
import { roomRouter } from "./room.router";
import { motionRouter } from "./motion.router";
import { speechRouter } from "./speech.router";
import { poiRouter } from "./poi.router";
import { analysisRouter } from "./analysis.router";
import { feedbackRouter } from "./feedback.router";
import { violationRouter } from "./violation.router";
import { constantsRouter } from "./constants.router";
import { ttsRouter } from "./tts.router";
import { transcriptRouter } from "./transcript.router";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  profile: profileRouter,
  room: roomRouter,
  motion: motionRouter,
  speech: speechRouter,
  poi: poiRouter,
  analysis: analysisRouter,
  feedback: feedbackRouter,
  violation: violationRouter,
  constants: constantsRouter,
  tts: ttsRouter,
  transcript: transcriptRouter,
});

export type AppRouter = typeof appRouter;
