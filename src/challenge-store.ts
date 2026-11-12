import { createQuickMatch } from './quick-match-view.js';
import { createPeopleView } from './challenge-people-view.js';
import { createRankCard } from './rank-card.js';

export function createChallengeStore() {
  return { quick: createQuickMatch(), people: createPeopleView(), rankCard: createRankCard() };
}

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
