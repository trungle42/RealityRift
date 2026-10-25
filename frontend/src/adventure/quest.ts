/**
 * "Show me X" quest: the storyteller asks for a real object, Gemini vision checks the webcam photo.
 * Pure (no DOM) so the response check can be unit tested. Matches backend/app/schemas.py `VerifyResponse`.
 */
export interface VerifyResponse { match: boolean; seen: string; source: 'gemini' | 'fallback' }

/** Validate what /api/verify returned. Anything unexpected is rejected rather than half-trusted. */
export function parseVerifyResponse(raw: unknown): VerifyResponse | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { match, seen, source } = raw as { match?: unknown; seen?: unknown; source?: unknown };
  if (typeof match !== 'boolean' || (source !== 'gemini' && source !== 'fallback')) return undefined;
  return { match, seen: typeof seen === 'string' ? seen.trim().slice(0, 80) : '', source };
}
