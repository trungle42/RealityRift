import { Application, type Ticker, type FederatedPointerEvent } from 'pixi.js';
import { Narrator } from '../src/audio/Narrator';
import { Sfx } from '../src/audio/Sfx';
import { Campaign } from '../src/campaign/Campaign';
import { questFor } from '../src/campaign/locations';
import { distance } from '../src/campaign/navigation';
import type { StoryBeat } from '../src/contracts';
import { now, startClock, onFrame, wait } from '../src/core/clock';
import { initTextures } from '../src/fx/textures';
import { GameState } from '../src/game/GameState';
import { Stage } from '../src/game/Stage';
import { KeyboardInput } from '../src/input/KeyboardInput';
import { GROUND_Y, HERO_X } from '../src/theme';
import { Enemy } from '../src/world/Enemy';
import { loadArt } from '../src/world/art';

const app = new Application();
await app.init({ resizeTo: window, background: 0x081713, antialias: true });
document.body.prepend(app.canvas);
let speed = 1;
startClock({ add: (fn: (ticker: Ticker) => void) => app.ticker.add((t) => { for (let i = 0; i < speed; i++) fn(t); }) } as Ticker);
initTextures(app.renderer); await loadArt(() => {});
const input = new KeyboardInput(), narrator = new Narrator(); narrator.enabled = false;
const stage = new Stage(input, new Sfx(), narrator); app.stage.addChild(stage.root);
const layout = () => stage.layout(app.screen.width, app.screen.height);
app.renderer.on('resize', layout);
const status = document.querySelector('#status')!, results = document.querySelector('#results')!;
let running = false;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function key(code: string, down = true): void { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); }
function tap(code: string): void { key(code); key(code, false); }
function click(selector: string): void { const node = document.querySelector<HTMLButtonElement>(selector); assert(node, `missing ${selector}`); node.click(); }
async function eventually(predicate: () => boolean, message: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let elapsed = 0;
    const off = onFrame((dt) => {
      elapsed += dt;
      if (predicate()) { off(); resolve(); }
      else if (elapsed > 12) { off(); reject(new Error(message)); }
    });
  });
}
async function check(name: string, task: () => Promise<void>): Promise<void> {
  status.textContent = name;
  const row = document.createElement('li'); results.append(row);
  try { await task(); row.className = 'pass'; row.textContent = `PASS · ${name}`; }
  catch (error) { row.className = 'fail'; row.textContent = `FAIL · ${name}: ${String(error)}`; throw error; }
}
const beat = (id: string, environment: StoryBeat['environment'] = 'forest'): StoryBeat => ({ id, environment, chapter: 'Campaign checks', narration: [] });
async function near(x: number, y: number): Promise<void> { stage.heroes[0].position.set(x, y); stage.heroes[1].position.set(x - 70, y + 10); await wait(0.05); }

async function suite(): Promise<void> {
  if (running) return; running = true; speed = 5; results.replaceChildren();
  document.querySelector<HTMLButtonElement>('#run')!.disabled = true;
  stage.begin(new GameState([{ index: 0, name: 'Rowan' }, { index: 1, name: 'Wren' }]));
  stage.setGameplayVisible(true); layout();
  const campaign = new Campaign(stage);
  let session = campaign.explore(beat('intro'));
  try {
    await eventually(() => !!document.querySelector('.campaign') && stage.actors.children.length > 5, 'exploration did not start');
    await wait(0.2);
    await check('WASD moves Hero One; exploration does not trigger a crouching pose', async () => {
      const x = stage.heroes[0].x, y = stage.heroes[0].y;
      key('KeyD'); await wait(0.45); key('KeyD', false);
      assert(stage.heroes[0].x > x + 50, 'hero did not walk');
      assert(stage.heroes[0].animationState.clip === 'walk', 'walking clip was not rendered');
      key('KeyS'); await wait(0.2); key('KeyS', false);
      assert(stage.heroes[0].y > y + 10 && stage.exploring, 'world movement failed');
    });
    await check('Running, rear-facing walking and dodge use their rendered animation clips', async () => {
      await near(300, 530); key('KeyD'); key('Space'); await wait(0.1);
      assert(stage.heroes[0].animationState.clip === 'run', 'running clip missing');
      key('Space', false); key('KeyD', false); key('KeyW'); await wait(0.1);
      assert(String(stage.heroes[0].animationState.clip) === 'backwalk', 'rear-facing clip missing');
      key('KeyW', false); tap('ShiftLeft'); await wait(0.08);
      assert(String(stage.heroes[0].animationState.clip) === 'roll', 'dodge clip missing');
      await wait(1.3);
    });
    await check('Arrow keys control Hero Two and companion follow can be disabled', async () => {
      click('.follow-button'); const x = stage.heroes[1].x;
      key('ArrowRight'); await wait(0.35); key('ArrowRight', false);
      assert(stage.heroes[1].x > x + 40, 'second hero did not move');
      assert(document.querySelector('.follow-button')!.getAttribute('aria-pressed') === 'false', 'follow toggle failed');
    });
    await check('Pillars block walking and dash movement', async () => {
      await near(450, 510); key('KeyD'); tap('ShiftLeft'); await wait(0.8); key('KeyD', false);
      assert(stage.heroes[0].x < 480, 'hero crossed the solid pillar');
    });
    await check('Click-to-walk finds a route around solid scenery', async () => {
      await near(400, 510);
      const ground = stage.actors.children.find((c) => c.label === 'campaign-ground'); assert(ground, 'no walking surface');
      ground.emit('pointertap', { getLocalPosition: () => ({ x: 680, y: 510 }) } as unknown as FederatedPointerEvent);
      await eventually(() => distance(stage.heroes[0], { x: 680, y: 510 }) < 24, 'click path did not reach its destination');
      assert(Number.isFinite(stage.heroes[0].x), 'hero coordinates became invalid');
    });
    await check('Chests award each hero once, even when opened repeatedly', async () => {
      await near(290, 458); tap('KeyE'); await wait(0.1); tap('KeyE');
      assert(stage.state.stars[0] === 2 && stage.state.stars[1] === 2, 'duplicate or missing treasure stars');
    });
    await check('Full hearts preserve a spring; wounded heroes can use it only once', async () => {
      await near(415, 603); tap('KeyE');
      assert(!campaign.progress.collected.has('forest:shrine'), 'full health consumed the spring');
      stage.loseHeart(); tap('KeyE'); await wait(0.1);
      assert(stage.state.hearts === 3, 'spring did not heal');
      stage.loseHeart(); tap('KeyE'); assert(Number(stage.state.hearts) === 2, 'spring healed twice');
    });
    await check('Sealed crossings cannot bypass the story route', async () => {
      await near(1060, 433); tap('KeyE'); await wait(0.2);
      assert(campaign.progress.region === 'forest', 'locked crossing was entered');
    });
    await check('Waykeeper dialogue pauses the game and closes safely', async () => {
      await near(665, 420); tap('KeyE');
      assert(document.querySelector('dialog[open]'), 'dialogue did not open');
      const time = now(); await new Promise((r) => setTimeout(r, 120));
      assert(now() === time, 'clock advanced during dialogue');
      click('.campaign-journal .primary-button'); await wait(0.1);
    });
    await check('Quest interaction returns control and cleans up exploration', async () => {
      const quest = questFor(beat('intro')); await near(quest.x, quest.y); tap('KeyE');
      assert(await session, 'quest did not resolve');
      assert(!document.querySelector('.campaign') && !stage.exploring, 'exploration UI leaked');
      assert(stage.actors.children.length === 2, 'exploration actors leaked');
      stage.heroes.forEach((h, i) => assert(h.x === HERO_X[i] && h.y === GROUND_Y && h.scale.x === 1, 'combat layout not restored'));
      const x = stage.heroes[0].x; key('KeyD'); await wait(0.2); key('KeyD', false); assert(stage.heroes[0].x === x, 'exploration key listener leaked');
    });
    session = campaign.explore(beat('gate', 'castle'));
    await eventually(() => document.querySelector('.campaign')?.getAttribute('aria-busy') === 'false', 'next exploration did not load');
    await check('A story unlock opens travel; returning preserves collected treasure', async () => {
      await near(1060, 433); tap('KeyE');
      await eventually(() => campaign.progress.region === 'castle', 'castle crossing failed');
      await near(170, 450); tap('KeyE');
      await eventually(() => campaign.progress.region === 'forest', 'return crossing failed');
      await near(290, 458); tap('KeyE'); assert(stage.state.stars.every((n) => n === 2), 'treasure respawned after travel');
    });
    await check('Roaming guardians can be defeated; simultaneous spells credit one kill', async () => {
      const enemy = stage.actors.children.find((a) => a instanceof Enemy) as Enemy;
      assert(enemy, 'no roaming guardian'); await near(enemy.x - 160, enemy.y - 30);
      tap('KeyF'); tap('Slash'); await wait(0.5);
      assert(campaign.progress.defeated.has('forest:guardian'), 'guardian not defeated');
      assert(stage.state.stars[0] + stage.state.stars[1] === 6, 'guardian scored more than one kill');
    });
    await check('Guardians stay defeated when the player leaves and returns', async () => {
      await near(1060, 433); tap('KeyE'); await eventually(() => campaign.progress.region === 'castle', 'travel failed');
      await near(170, 450); tap('KeyE'); await eventually(() => campaign.progress.region === 'forest', 'return failed');
      assert(!stage.actors.children.some((a) => a instanceof Enemy), 'guardian respawned');
    });
    await check('A guardian telegraphs its attack and a timely dodge avoids damage', async () => {
      await near(1060, 433); tap('KeyE'); await eventually(() => campaign.progress.region === 'castle', 'travel failed');
      await wait(2.3);
      const enemy = stage.actors.children.find((a) => a instanceof Enemy) as Enemy; assert(enemy, 'no castle guardian');
      await near(enemy.x - 20, enemy.y); await wait(0.25);
      key('KeyA'); await wait(0.03); tap('ShiftLeft'); key('KeyA', false); await wait(0.8);
      assert(stage.state.hearts === 2, 'dodge did not avoid the telegraphed strike');
    });
    await check('Actual guardian attacks deplete shared hearts and exit exploration cleanly', async () => {
      const enemy = stage.actors.children.find((a) => a instanceof Enemy) as Enemy;
      await near(enemy.x, enemy.y);
      await eventually(() => stage.state.defeated, 'guardian attacks did not cause defeat');
      assert(await session === false, 'defeat did not end exploration');
      assert(stage.actors.children.length === 2 && !document.querySelector('.campaign'), 'defeat leaked exploration state');
    });
    await check('A fresh campaign can unlock and enter the cave route independently', async () => {
      stage.begin(new GameState([{ index: 0, name: 'Rowan' }, { index: 1, name: 'Wren' }]));
      const caveCampaign = new Campaign(stage); session = caveCampaign.explore(beat('gate', 'cave'));
      await eventually(() => document.querySelector('.campaign')?.getAttribute('aria-busy') === 'false', 'cave route did not load');
      await near(1090, 590); tap('KeyE'); await eventually(() => caveCampaign.progress.region === 'cave', 'cave crossing failed');
      assert(!caveCampaign.progress.unlocked.has('castle'), 'other story route unlocked unexpectedly');
      const quest = questFor(beat('gate', 'cave')); await near(quest.x, quest.y); tap('KeyE');
      assert(await session, 'cave gate quest failed');
      assert(stage.actors.children.length === 2, 'cave cleanup failed');
    });
    status.textContent = `All ${results.children.length} campaign checks passed.`;
    document.body.dataset.result = 'passed';
  } catch (error) {
    status.textContent = `Campaign checks failed: ${String(error)}`; document.body.dataset.result = 'failed'; console.error(error);
    while (stage.state.hearts > 0) stage.loseHeart();
    if (document.querySelector<HTMLDialogElement>('dialog[open]')) document.querySelector<HTMLDialogElement>('dialog[open]')!.close();
    await session;
  } finally {
    speed = 1; running = false; document.querySelector<HTMLButtonElement>('#run')!.disabled = false;
  }
}
document.querySelector('#run')!.addEventListener('click', () => void suite());
document.querySelector('#hide')!.addEventListener('click', () => { document.querySelector<HTMLElement>('#checks')!.hidden = true; });
