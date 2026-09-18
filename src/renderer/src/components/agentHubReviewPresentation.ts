/**
 * Presentation-only helpers for AgentHub Review / Evidence UI.
 * 
 * Invariants:
 * - Pure functions with zero side-effects.
 * - Does NOT mutate canonical stored strings or objects.
 * - Escapes or substitutes control characters (e.g. NUL) for visual display only.
 * - Never synthesizes missing backend values.
 */

/**
 * Format stdout/stderr preview for visual display.
 * Substitutes NUL characters with visible symbol '␀' without altering the canonical input.
 */
export function formatDisplayPreview(raw: string): string {
  if (!raw) return '';
  return raw.replaceAll('\0', '␀');
}

/**
 * Format exitCode for display.
 * If exitCode is undefined or null, indicates not provided rather than synthesizing 0 or -1.
 */
export function formatExitCode(exitCode?: number | null): string {
  if (exitCode === undefined || exitCode === null) {
    return 'Not provided';
  }
  return String(exitCode);
}

/**
 * Format committedPatch for display.
 * If absent, returns honest notification string.
 */
export function formatCommittedPatch(patch?: string): string {
  return patch === undefined
    ? 'No committed patch value returned.'
    : patch;
}
