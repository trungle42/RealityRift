import { Application, Text, type Ticker } from 'pixi.js';
import type { InputSource, InputEvent, PlayerIndex, PlayerFrame, EnvironmentId } from '../src/contracts';
import { startClock, onFrame } from '../src/core/clock';
import { initTextures } from '../src/fx/textures';
import { loadArt } from '../src/world/art';
import { Stage } from '../src/game/Stage';
import { GameState } from '../src/game/GameState';
import { Narrator } from '../src/audio/Narrator';
import { Sfx } from '../src/audio/Sfx';
import { runFreeze } from '../src/challenges/freeze';
import { runPose } from '../src/challenges/pose';
import { runVote } from '../src/challenges/vote';
import { runEncounter } from '../src/challenges/encounter';
import { runBoss } from '../src/challenges/boss';
import { Boss } from '../src/world/Boss';
import { FOE_X, GROUND_Y } from '../src/theme';

class TestInput implements InputSource {
  frames: [PlayerFrame, PlayerFrame] = [0, 1].map(() => ({ present: true, motion: 0, pose: null })) as [PlayerFrame, PlayerFrame];
  listeners = new Set<(event: InputEvent) => void>();
  read(player: PlayerIndex): PlayerFrame { return this.frames[player]; }
  subscribe(listener: (event: InputEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(event: InputEvent): void { for (const listener of [...this.listeners]) listener(event); }
  destroy(): void { this.listeners.clear(); }
}
const app = new Application();
await app.init({ resizeTo: window, background: 0x081713, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
document.body.prepend(app.canvas);
let speed = 1;
startClock({ add: (fn: (ticker: Ticker) => void) => app.ticker.add((ticker) => { for (let i = 0; i < speed; i++) fn(ticker); }) } as Ticker);
initTextures(app.renderer);
await loadArt(() => {});
const input = new TestInput();
const narrator = new Narrator(); narrator.enabled = false;
const stage = new Stage(input, new Sfx(), narrator);
app.stage.addChild(stage.root);
const layout = () => stage.layout(app.screen.width, app.screen.height);
layout(); app.renderer.on('resize', layout);
const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
let previewBoss: Boss | undefined;
let running = false;

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function fresh(): void {
  stage.begin(new GameState([{ index: 0, name: 'Rowan' }, { index: 1, name: 'Wren' }]));
  stage.setGameplayVisible(true);
  input.frames = [0, 1].map(() => ({ present: true, motion: 0, pose: null })) as [PlayerFrame, PlayerFrame];
}
const heading = () => (stage.prompt.children.find((c) => c instanceof Text) as Text).text;
function autoCast(boss = false): () => void {
  let timer = 0;
  return onFrame((dt) => {
    timer += dt;
    if (timer < 0.12 || (boss && heading() !== 'It Falters!')) return;
    timer = 0;
    for (const player of [0, 1] as const) input.emit({ kind: 'cast', player });
  });
}
async function check(name: string, work: () => Promise<void>): Promise<void> {
  fresh();
  status.textContent = `Checking: ${name}`;
  const li = document.createElement('li'); results.appendChild(li);
  const before = input.listeners.size;
  try {
    await work();
    assert(input.listeners.size === before, 'challenge leaked an input listener');
    assert(stage.state.hearts >= 0 && stage.state.hearts <= 3, 'hearts outside bounds');
    assert(stage.actors.children.length === 2, 'encounter actors were not cleaned up');
    li.textContent = `PASS · ${name}`; li.className = 'pass';
  } catch (error) {
    li.textContent = `FAIL · ${name}: ${String(error)}`; li.className = 'fail';
    console.error(name, error); throw error;
  }
}

async function suite(): Promise<void> {
  if (running) return;
  running = true; previewBoss?.destroy(); previewBoss = undefined;
  document.querySelector<HTMLButtonElement>('#run')!.disabled = true;
  results.replaceChildren(); speed = 8;
  try {
    await stage.setEnvironment('forest');
    await check('Freeze success: two stars, no lost heart', async () => {
      const result = await runFreeze(stage, 'freeze', { type: 'freeze', prompt: 'Stay still', durationSec: 1, tolerance: 0.3 });
      assert(result.success && stage.state.hearts === 3, 'freeze should pass');
      assert(stage.state.stars.every((n) => n === 1), 'each hero must earn one star');
    });
    await check('Freeze failure: both moving costs only one shared heart', async () => {
      input.frames.forEach((f) => f.motion = 1);
      const result = await runFreeze(stage, 'freeze', { type: 'freeze', prompt: 'Stay still', durationSec: 1, tolerance: 0.3 });
      assert(!result.success && result.heartsLost === 1 && stage.state.hearts === 2, 'shared heart loss mismatch');
    });
    await check('Pose success: both hold the actual target', async () => {
      input.frames.forEach((f) => f.pose = 't-pose');
      const result = await runPose(stage, 'pose', { type: 'pose', prompt: 'Mirror', poses: ['t-pose'], secondsPerPose: 1.5 });
      assert(result.success && stage.state.stars.every((n) => n === 1), 'pose should award both players');
    });
    await check('Missing player cannot pass a pose with stale input', async () => {
      input.frames.forEach((f) => { f.present = false; f.pose = 'arms-up'; });
      const result = await runPose(stage, 'pose', { type: 'pose', prompt: 'Mirror', poses: ['arms-up'], secondsPerPose: 1 });
      assert(!result.success && result.heartsLost === 1, 'missing tracking was accepted');
    });
    await check('Voting records a shared path choice', async () => {
      const off = onFrame(() => { if (input.listeners.size) { input.emit({ kind: 'right', player: 0 }); input.emit({ kind: 'right', player: 1 }); off(); } });
      const result = await runVote(stage, 'vote', { type: 'vote', prompt: 'Choose', options: [{ id: 'castle', label: 'Castle' }, { id: 'cave', label: 'Cave' }], timeLimitSec: 3 });
      off(); assert(result.choiceId === 'cave' && result.success, 'vote result mismatch');
    });
    await check('Voting timeout resolves with no player input', async () => {
      const result = await runVote(stage, 'vote', { type: 'vote', prompt: 'Choose', options: [{ id: 'castle', label: 'Castle' }, { id: 'cave', label: 'Cave' }], timeLimitSec: 0.3 });
      assert(['castle', 'cave'].includes(result.choiceId!), 'timeout produced no choice');
    });
    await check('Enemy victory credits each defeated creature once', async () => {
      const stop = autoCast();
      try {
        const result = await runEncounter(stage, 'encounter', { enemy: 'shadow-wisp', count: 4, speed: 1 });
        assert(result.success && stage.state.stars[0] + stage.state.stars[1] === 4, 'kills / stars mismatch');
      } finally { stop(); }
    });
    await check('Enemy defeat stops at zero hearts and cleans up every actor', async () => {
      const result = await runEncounter(stage, 'encounter', { enemy: 'thorn-imp', count: 8, speed: 4 });
      assert(!result.success && stage.state.hearts === 0 && result.heartsLost === 3, 'defeat accounting mismatch');
    });
    await stage.setEnvironment('castle');
    await check('Frost queen: telegraphs, dodges, spells and charm produce victory', async () => {
      input.frames.forEach((f) => f.pose = 'crouch');
      stage.state.rewards.push({ kind: 'boss-weaken', name: 'Charm', description: '' });
      const stop = autoCast(true);
      try {
        const result = await runBoss(stage, 'boss', { kind: 'frost-witch', name: 'Morwen the Frost Witch', maxHp: 14, attacks: ['frost-gaze', 'shadow-wave'], telegraphSec: 1, vulnerableSec: 3 });
        assert(result.success && result.heartsLost === 0, 'boss victory failed');
        assert(stage.state.stars.every((n) => n > 0), 'boss did not award per-player stars');
      } finally { stop(); }
    });
    await stage.setEnvironment('cave');
    await check('Dragon: fairy ally and quick-cast work, then clean up', async () => {
      input.frames.forEach((f) => f.pose = 'crouch');
      stage.state.rewards.push({ kind: 'fairy-ally', name: 'Pip', description: '' }, { kind: 'quick-cast', name: 'Wand', description: '' });
      const stop = autoCast(true);
      try {
        const result = await runBoss(stage, 'boss', { kind: 'shadow-dragon', name: 'Umbraxis', maxHp: 16, attacks: ['shadow-wave', 'frost-gaze'], telegraphSec: 1, vulnerableSec: 3 });
        assert(result.success && stage.state.hearts === 3, 'dragon victory failed');
      } finally { stop(); }
    });
    await check('Boss defeat reports all three hearts lost', async () => {
      input.frames.forEach((f) => { f.present = false; f.motion = 0; f.pose = 'crouch'; });
      const result = await runBoss(stage, 'boss', { kind: 'shadow-dragon', name: 'Umbraxis', maxHp: 16, attacks: ['frost-gaze', 'shadow-wave'], telegraphSec: 0.5, vulnerableSec: 0.3 });
      assert(!result.success && result.heartsLost === 3 && stage.state.hearts === 0, 'boss heart-loss history incorrect');
    });
    fresh();
    assert(input.listeners.size === 0, 'input subscriptions leaked across replay');
    status.textContent = `All ${results.children.length} engine scenarios passed. Replay reset passed.`;
    document.body.dataset.result = 'passed';
  } catch { status.textContent = 'Gameplay checks failed; see results.'; document.body.dataset.result = 'failed'; }
  finally { speed = 1; running = false; document.querySelector<HTMLButtonElement>('#run')!.disabled = false; }
}
document.querySelector('#run')!.addEventListener('click', () => void suite());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scene]')) {
  button.addEventListener('click', async () => {
    if (running) return;
    previewBoss?.destroy(); previewBoss = undefined; fresh();
    const env = button.dataset.scene as EnvironmentId;
    await stage.setEnvironment(env);
    stage.hud.setChapter(env === 'forest' ? 'Chapter I · The Whispering Wood' : env === 'castle' ? 'Finale · The Frozen Throne' : 'Finale · The Wyrm’s Hoard');
    if (env !== 'forest') {
      previewBoss = new Boss(env === 'castle' ? 'frost-witch' : 'shadow-dragon');
      previewBoss.position.set(FOE_X, GROUND_Y); stage.actors.addChild(previewBoss);
      await stage.bossBar.show(env === 'castle' ? 'Morwen the Frost Witch' : 'Umbraxis the Shadow Wyrm');
    } else await stage.bossBar.hide();
  });
}
document.querySelector('#hide')!.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#checks')!.hidden = true;
  document.querySelector<HTMLElement>('#scene-tools')!.hidden = true;
});
fresh(); await stage.setEnvironment('forest');
