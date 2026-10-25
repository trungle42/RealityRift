import { Application } from 'pixi.js';
import { Narrator } from './audio/Narrator';
import { Sfx } from './audio/Sfx';
import { startClock } from './core/clock';
import { initTextures } from './fx/textures';
import { Game } from './game/Game';
import { Stage } from './game/Stage';
import { KeyboardInput } from './input/KeyboardInput';
import { GeminiStory } from './story/GeminiStory';
import { ScriptedStory } from './story/ScriptedStory';
import { palette } from './theme';
import { loadArt } from './world/art';
import { setupGameTools } from './ui/Controls';

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
  app.canvas.setAttribute('aria-label', 'Storybound game world');
  app.canvas.tabIndex = 0;
  await loadFonts();

  startClock(app.ticker);
  initTextures(app.renderer);
  await loadArt((fraction) => {
    const progress = document.querySelector<HTMLProgressElement>('#loading-progress');
    if (progress) progress.value = fraction;
  });

  // Swap these for the MediaPipe input (Dev 3) and Gemini storyteller (Dev 2).
  const input = new KeyboardInput();
  // Gemini storyteller with the scripted tale as per-beat fallback. Set VITE_STORY=scripted to force offline.
  const scripted = new ScriptedStory();
  const story = import.meta.env.VITE_STORY === 'scripted' ? scripted : new GeminiStory(scripted);

  const narrator = new Narrator();
  setupGameTools(narrator);

  const stage = new Stage(input, new Sfx(), narrator);
  app.stage.addChild(stage.root);
  const layout = () => stage.layout(app.screen.width, app.screen.height);
  layout();
  app.renderer.on('resize', layout);

  document.getElementById('loading')?.remove();
  await new Game(stage, story).run();
}

void boot().catch((error: unknown) => {
  console.error('Unable to start Storybound', error);
  document.getElementById('loading')?.remove();
  const errorScreen = document.createElement('div');
  errorScreen.className = 'loading-screen';
  errorScreen.innerHTML = '<h1>The rift needs a moment</h1><p>The adventure could not load. Please try again.</p><button class="primary-button" type="button">Try again</button>';
  errorScreen.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.appendChild(errorScreen);
});
