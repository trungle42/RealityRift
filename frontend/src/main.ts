import { Application } from 'pixi.js';
import { Narrator } from './audio/Narrator';
import { Sfx } from './audio/Sfx';
import { startClock } from './core/clock';
import { initTextures } from './fx/textures';
import { Game } from './game/Game';
import { Stage } from './game/Stage';
import { KeyboardInput } from './input/KeyboardInput';
import { ScriptedStory } from './story/ScriptedStory';
import { palette } from './theme';

async function loadFonts(): Promise<void> {
  const faces = ['700 40px "Cinzel Decorative"', '500 40px "Cinzel"', '700 40px "Cinzel"', '40px "IM Fell English"', 'italic 40px "IM Fell English"'];
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
  await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f))), timeout]).catch(() => undefined);
}

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: palette.night,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById('app')!.appendChild(app.canvas);
  await loadFonts();

  startClock(app.ticker);
  initTextures(app.renderer);

  // Swap these for the MediaPipe input (Dev 3) and Gemini storyteller (Dev 2).
  const input = new KeyboardInput();
  const story = new ScriptedStory();

  const narrator = new Narrator();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) narrator.toggle();
  });

  const stage = new Stage(input, new Sfx(), narrator);
  app.stage.addChild(stage.root);
  const layout = () => stage.layout(app.screen.width, app.screen.height);
  layout();
  app.renderer.on('resize', layout);

  void new Game(stage, story).run();
}

void boot();
