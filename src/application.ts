import { createSuggestion } from './suggestion-dialog.js';
import { createInbox } from './inbox.js';
import { createFriendsBoard } from './friends-board.js';
import { createAccountDeletion } from './account-deletion.js';
import { startPageWork } from './async-runtime.js';
import { createProfileSync } from './profile-sync.js';
import { createAccountSession } from './account-session.js';
import { createThemeEditor } from './theme-editor.js';
import { createWallpaper } from './wallpaper.js';
import { createChallengeStore } from './challenge-store.js';
import { createQuoteFilters } from './quote-filters.js';
import { createCompose } from './compose-view.js';
import { createSettings } from './settings.js';
import { createPalette } from './palette.js';
import { createLearningStore } from './learning-store.js';
import { createPracticeSession } from './practice-session.js';

export function createApplication() {
  startPageWork();
  const accounts = createAccountSession();
  const learning = createLearningStore();

  return {
    accounts, learning,
    inbox: createInbox(),
    friendsBoard: createFriendsBoard(),
    deletion: createAccountDeletion(accounts),
    sync: createProfileSync(learning, accounts),
    practice: createPracticeSession(),
    themeEditor: createThemeEditor(),
    wallpaper: createWallpaper(),
    challenge: createChallengeStore(),
    quoteFilters: createQuoteFilters(),
    compose: createCompose(),
    settings: createSettings(),
    palette: createPalette(),
    suggestion: createSuggestion(),
  };
}

export type Application = ReturnType<typeof createApplication>;
