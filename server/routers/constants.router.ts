import { publicProcedure, router } from "../_core/trpc";
import {
  ASIAN_PARLIAMENTARY_FORMAT,
  TOPIC_AREAS,
  DIFFICULTY_LEVELS,
  EXPERIENCE_LEVELS,
} from "@shared/debate";

export const constantsRouter = router({
  getDebateFormat: publicProcedure.query(() => ASIAN_PARLIAMENTARY_FORMAT),
  getTopicAreas: publicProcedure.query(() => TOPIC_AREAS),
  getDifficultyLevels: publicProcedure.query(() => DIFFICULTY_LEVELS),
  getExperienceLevels: publicProcedure.query(() => EXPERIENCE_LEVELS),
});
