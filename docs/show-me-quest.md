# "Show me X" quest — status and handoff

Goal: the storyteller asks the player to show a real object (a book, a cup); Gemini vision checks the
webcam photo; a door opens.

## Done (branch `feature/reality-rift-scan`)
- `POST /api/verify` in `backend/app/main.py` + `gemini.verify_object` (tests in `backend/tests/test_api.py`).
  Offline/no key returns `match: true, source: "fallback"`.
- `frontend/src/adventure/quest.ts` `parseVerifyResponse` (tests in `frontend/tests/quest.test.mjs`).
- Documented in `docs/api-contract.md`.

## Not done (nothing below is wired in, so the game is unchanged)
1. `contracts.ts`: add `{ type: 'show'; prompt: string; object: string }` to `ChallengeSpec` and `'show'` to `OutcomeKind`
   (check `Game.ts`/classic runner still typecheck).
2. `Scanner.ts`: an `ask(object): Promise<boolean>` mode that reuses the camera, posts to `/api/verify`, shows
   what Gemini saw on a miss, and offers Try again / Skip (skip = fail, no heart lost).
3. `Adventure.ts` `runBeat`: handle `challenge.type === 'show'` via `scanner.ask`, then `complete('show', ok, …)`.
4. Stories: add a `show-me` beat after a successful `gate` in `ScriptedStory.ts` and mirror it in
   `backend/app/provider.py` (`OUTCOME_KIND` needs `"show"`; update `tests/test_provider.py` sequences).
   Suggested objects: castle "a book", cave "a bottle or a cup".
5. Browser check in `tests/adventure.ts` for the new beat.
