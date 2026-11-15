// Whether the side bar is hidden. Device state, never a preference, so it never syncs: a signed-in person's choice
// stays on this device under their id; a guest's lasts for the tab (PRODUCT.md: guests save nothing).
// src/prepaint.ts reads the same key before first paint.
export const SIDE_BAR_KEY = 'stilltype-side-bar-v1:';

export function storedSideBarHidden(userId: string | null): boolean {
  if (!userId) return false;

  try { return localStorage.getItem(SIDE_BAR_KEY + userId) === 'hidden'; } catch { return false; }
}

export function storeSideBarHidden(userId: string | null, hidden: boolean) {
  if (!userId) return;

  try {
    if (hidden) localStorage.setItem(SIDE_BAR_KEY + userId, 'hidden');
    else localStorage.removeItem(SIDE_BAR_KEY + userId);
  } catch {}
}
