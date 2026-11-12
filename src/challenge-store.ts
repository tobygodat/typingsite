import { createRankCard } from './rank-card.js';

export function createChallengeStore() {
  return { rankCard: createRankCard() };
}

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
