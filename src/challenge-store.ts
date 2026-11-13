import { createDailyChallenge } from './daily-challenge.js';
import type { LearningStore } from './learning-store.js';
import { createLocalRace } from './local-race.js';
import { createRaceReview } from './race-review.js';
import { createQuickMatch } from './quick-match-view.js';
import { createPeopleView } from './challenge-people-view.js';
import { createRankCard } from './rank-card.js';

export function createChallengeStore(learning: LearningStore) {
  return { daily: createDailyChallenge(learning), local: createLocalRace(), review: createRaceReview(), quick: createQuickMatch(), people: createPeopleView(), rankCard: createRankCard() };
}

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
