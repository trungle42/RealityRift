import { Adventure } from '../src/adventure/Adventure';

// Development-only: one "laptop" for tests/multiplayer.html. A real game with this frame's own ?presence / ?room / ?name /
// ?wand, started at once (the start form is submitted), with its clock handed to the harness (frames do not run in a hidden
// pane), and exposed as window.__storybound.game next to the presence client.
const game = new Adventure();
const w = window as unknown as { __storybound?: Record<string, unknown> };
void (async () => {
  const start = game.start();
  const form = await new Promise<HTMLFormElement>((resolve) => { const t = setInterval(() => { const f = document.querySelector<HTMLFormElement>('.adventure-start form'); if (f) { clearInterval(t); resolve(f); } }, 100); });
  form.requestSubmit(); await start;
  game.renderer.setAnimationLoop(null);
  w.__storybound = { ...w.__storybound, game, ready: true };
})();
