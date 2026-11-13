import { createGhostResult } from './ghost-result.js';
import { createGhostOffer } from './ghost-offer.js';
import { createNavigation } from './navigation.js';
import { createTrainingMemory } from './training-memory.js';
import { createCustomLength } from './custom-length.js';
import { createPracticeEditors } from './practice-editors.js';
import { createOnlineRace } from './online-race.js';
import { createPracticeRun } from './practice-run.js';
import { createPracticeRecording } from './practice-recording.js';
import { createHistoryClear } from './history-clear.js';
import { createReleaseDialog } from './release-dialog.js';
import { createSettingsImport } from './import-dialog.js';
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
  const practice = createPracticeSession();
  const sync = createProfileSync(learning, accounts);
  const onlineRace = createOnlineRace();
  const inbox = createInbox();

  return {
    accounts, learning, practice, sync,
    navigation: createNavigation(),
    training: createTrainingMemory(),
    editors: createPracticeEditors(learning, sync),
    lengthEditor: createCustomLength(learning, practice, sync),
    historyClear: createHistoryClear(learning, practice, sync),
    recording: createPracticeRecording(learning, sync),
    practiceRun: createPracticeRun(practice, learning, sync),
    onlineRace,
    ghostOffer: createGhostOffer(accounts, onlineRace),
    inbox,
    ghostResult: createGhostResult(accounts, practice, inbox),
    friendsBoard: createFriendsBoard(),
    deletion: createAccountDeletion(accounts),
    themeEditor: createThemeEditor(),
    wallpaper: createWallpaper(),
    challenge: createChallengeStore(learning),
    quoteFilters: createQuoteFilters(),
    compose: createCompose(),
    settings: createSettings(),
    palette: createPalette(),
    suggestion: createSuggestion(),
    importing: createSettingsImport(),
    release: createReleaseDialog(),
  };
}

export type Application = ReturnType<typeof createApplication>;
