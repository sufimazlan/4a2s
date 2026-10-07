// Navigation helpers shared by the screens.

let cameFromHome = false;

/** Called by the router on every route change. */
export function noteRoute(previous: string | null, next: string): void {
  cameFromHome = next !== '' && previous === '';
}

/**
 * Go back to the home screen without leaving extra history entries: step back
 * when we came from home (so the phone's Back button then exits), otherwise
 * replace the current entry (deep link or reload).
 */
export function goHome(): void {
  if (cameFromHome) history.back();
  else location.replace('#/');
}
