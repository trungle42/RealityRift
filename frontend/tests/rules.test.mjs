import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

// These modules depend only on erased types. Test the real TypeScript without
// adding a second bundler or a production testing dependency.
async function load(relative) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { GameState } = await load('../src/game/GameState.ts');
const { ScriptedStory } = await load('../src/story/ScriptedStory.ts');
const { isStill, matchesPose, initialBossHp, heartsLostSince, didWin } = await load('../src/game/rules.ts');
const { walkable, move, findPath, distance, depthScale } = await load('../src/campaign/navigation.ts');
const { CampaignProgress, REGIONS, questFor } = await load('../src/campaign/locations.ts');
const { HeroAnimation } = await load('../src/world/animation.ts');
const party = () => [{ index: 0, name: 'Rowan' }, { index: 1, name: 'Wren' }];
const outcome = (beatId, success = true, choiceId) => ({ beatId, kind: 'story', success, choiceId, heartsLost: success ? 0 : 1, perPlayer: [{ success, stars: 1 }, { success, stars: 1 }], summary: success ? 'The heroes prevailed' : 'The heroes stumbled' });

test('two heroes begin with three shared hearts and separate scores', () => {
  const state = new GameState(party());
  assert.equal(state.hearts, 3);
  state.stars[0] += 2;
  assert.deepEqual(state.stars, [2, 0]);
  assert.equal(state.defeated, false);
});
test('heart loss and healing respect the cap; defeat cannot be healed into victory', () => {
  const state = new GameState(party());
  assert.equal(state.gainHeart(), false);
  assert.equal(state.loseHeart(), true);
  assert.equal(state.gainHeart(), true);
  for (let i = 0; i < 5; i++) state.loseHeart();
  assert.equal(state.hearts, 0);
  assert.equal(state.defeated, true);
  assert.equal(state.gainHeart(), false);
});
test('provider history is a snapshot, including nested player outcomes and rewards', () => {
  const state = new GameState(party());
  state.outcomes.push(outcome('intro'));
  state.rewards.push({ kind: 'fairy-ally', name: 'Pip', description: 'An ally' });
  const snapshot = state.history();
  snapshot.party[0].name = 'Changed';
  snapshot.outcomes[0].perPlayer[0].stars = 99;
  snapshot.rewards[0].kind = 'quick-cast';
  assert.equal(state.party[0].name, 'Rowan');
  assert.equal(state.outcomes[0].perPlayer[0].stars, 1);
  assert.equal(state.has('fairy-ally'), true);
  assert.equal(state.has('quick-cast'), false);
});
test('undetected players cannot pass freeze or pose checks using stale tracking', () => {
  const missing = { present: false, motion: 0, pose: 'crouch' };
  assert.equal(isStill(missing, 0.3), false);
  assert.equal(matchesPose(missing, 'crouch'), false);
  assert.equal(isStill({ ...missing, present: true }, 0.3), true);
  assert.equal(matchesPose({ ...missing, present: true }, 'crouch'), true);
  assert.equal(isStill({ present: true, motion: 0.6, pose: null }, 0.3), false);
});
test('boss weakening and recorded heart losses use actual game values', () => {
  assert.equal(initialBossHp(16, true), 12);
  assert.equal(initialBossHp(14, false), 14);
  assert.equal(initialBossHp(1, true), 1);
  assert.equal(heartsLostSince(3, 1), 2);
  assert.equal(heartsLostSince(1, 3), 0);
});
test('victory requires a defeated boss and at least one surviving heart', () => {
  assert.equal(didWin(3, undefined), false);
  assert.equal(didWin(0, outcome('boss')), false);
  assert.equal(didWin(1, outcome('boss', false)), false);
  assert.equal(didWin(1, outcome('boss')), true);
});
test('zero hearts always selects the defeat ending', async () => {
  const state = new GameState(party()); state.hearts = 0;
  const next = await new ScriptedStory().next(state.history(), outcome('crossroads', true, 'castle'));
  assert.equal(next.id, 'ending-defeat');
  assert.equal(next.isEnding, true);
});
test('failure creates an enemy ambush; success grants a boss-weakening charm', async () => {
  const provider = new ScriptedStory(); const state = new GameState(party());
  const fail = await provider.next(state.history(), outcome('frost-spell', false));
  assert.equal(fail.encounter.enemy, 'shadow-wisp');
  const success = await provider.next(state.history(), outcome('frost-spell'));
  assert.equal(success.reward.kind, 'boss-weaken');
});
for (const route of ['castle', 'cave']) {
  for (const fairy of ['free', 'hurry']) {
    test(`complete ${route} route / ${fairy} choice reaches the correct boss, reward and storybook`, async () => {
      const provider = new ScriptedStory(); const state = new GameState(party());
      let beat = await provider.begin(state.party);
      let count = 0; let boss;
      while (!beat.isEnding && count++ < 20) {
        state.visit(beat.environment);
        if (beat.reward) state.rewards.push(beat.reward);
        if (beat.boss) boss = beat.boss;
        const result = outcome(beat.id, true, beat.id === 'crossroads' ? route : beat.id === 'lantern-fairy' ? fairy : undefined);
        result.kind = beat.boss ? 'boss' : beat.challenge?.type ?? 'story';
        state.outcomes.push(result);
        beat = await provider.next(state.history(), result);
      }
      assert.ok(count < 20, 'story must terminate');
      assert.equal(beat.id, 'ending-victory');
      assert.equal(boss.kind, route === 'castle' ? 'frost-witch' : 'shadow-dragon');
      assert.equal(state.has(fairy === 'free' ? 'fairy-ally' : 'quick-cast'), true);
      const book = await provider.storybook(state.history(), true);
      assert.match(book.title, /Rowan.*Wren/);
      assert.ok(book.pages.some((p) => p.heading === 'The Final Battle'));
      assert.equal(book.pages.at(-1).heading, 'Happily Ever After');
    });
  }
}
test('two earlier failures strengthen the final boss and shorten the warning', async () => {
  const state = new GameState(party());
  state.outcomes.push({ ...outcome('frost-spell', false), kind: 'freeze' }, { ...outcome('gate', false), kind: 'pose' });
  const beat = await new ScriptedStory().next(state.history(), outcome('fairy-joins'));
  assert.equal(beat.boss.maxHp, 18);
  assert.equal(beat.boss.telegraphSec, 1.7);
});
test('replay starts fresh without leaking prior rewards, history, or scores', () => {
  const first = new GameState(party()); first.hearts = 0; first.stars[0] = 9;
  first.rewards.push({ kind: 'quick-cast', name: 'Wand', description: '' });
  const replay = new GameState(first.party);
  assert.equal(replay.hearts, 3); assert.deepEqual(replay.stars, [0, 0]);
  assert.deepEqual(replay.outcomes, []); assert.equal(replay.has('quick-cast'), false);
});

test('walking and a long dash cannot tunnel through an obstacle or the world boundary', () => {
  const obstacles = [{ x: 500, y: 500, radius: 30 }];
  const stopped = move({ x: 400, y: 500 }, 600, 0, obstacles);
  assert.ok(stopped.x <= 456 && walkable(stopped, obstacles));
  const edge = move({ x: 300, y: 600 }, -1000, 1000, []);
  assert.ok(walkable(edge, []));
  assert.equal(walkable({ x: 100, y: 390 }, []), false, 'perspective edges must block movement');
  const pixiLike = Object.create({ get x() { return 300; }, get y() { return 500; } });
  assert.deepEqual(move(pixiLike, 20, 0, []), { x: 320, y: 500 });
});
test('click navigation routes around obstacles without clipping corners', () => {
  const obstacles = REGIONS.forest.obstacles;
  const path = findPath({ x: 245, y: 540 }, { x: 1000, y: 515 }, obstacles);
  assert.ok(path.length > 0);
  for (const point of path) assert.ok(walkable(point, obstacles));
  for (let i = 1; i < path.length; i++) {
    const moved = move(path[i - 1], path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, obstacles);
    assert.ok(distance(moved, path[i]) < 0.01, 'path segment must be traversable');
  }
  assert.ok(distance(path.at(-1), { x: 1000, y: 515 }) < 20);
});
test('every landmark and campaign quest has an accessible approach in its region', async () => {
  for (const route of ['castle', 'cave']) {
    const state = new GameState(party()), story = new ScriptedStory();
    let beat = await story.begin(state.party);
    while (!beat.isEnding) {
      const region = REGIONS[beat.environment];
      for (const target of [...region.landmarks, questFor(beat)]) {
        const path = findPath({ x: 245, y: 540 }, target, region.obstacles);
        assert.ok(path.length && distance(path.at(-1), target) < 85, `${beat.id}: ${target.name} unreachable`);
      }
      const result = outcome(beat.id, true, beat.id === 'crossroads' ? route : 'free');
      state.outcomes.push(result); beat = await story.next(state.history(), result);
    }
  }
});
test('clicks outside the clearing resolve to a reachable edge and depth scales nearer heroes up', () => {
  const path = findPath({ x: 245, y: 540 }, { x: -9000, y: -9000 }, REGIONS.cave.obstacles);
  assert.ok(path.length && walkable(path.at(-1), REGIONS.cave.obstacles));
  assert.ok(depthScale(400) < depthScale(600));
});
test('treasure claims are unique per area, route locks follow the story, replay is fresh', () => {
  const campaign = new CampaignProgress();
  assert.deepEqual([...campaign.unlocked], ['forest']);
  assert.equal(campaign.claim('forest:chest'), true);
  assert.equal(campaign.claim('forest:chest'), false);
  assert.equal(campaign.claim('castle:chest'), true);
  campaign.unlock({ environment: 'cave' });
  assert.equal(campaign.unlocked.has('cave'), true);
  assert.equal(campaign.unlocked.has('castle'), false);
  const replay = new CampaignProgress();
  assert.equal(replay.collected.size, 0); assert.equal(replay.defeated.size, 0);
  assert.deepEqual([...replay.unlocked], ['forest']);
});

test('movement animation cycles use distinct frames, turn correctly and stop at idle', () => {
  const animation = new HeroAnimation(); animation.move('walk', 1, 0);
  const frames = new Set(Array.from({ length: 20 }, () => animation.advance(0.08).frame));
  assert.equal(frames.size, 5);
  animation.move('walk', -1, -1); assert.equal(animation.advance(0.1).clip, 'backwalk');
  assert.equal(animation.current.facing, -1);
  animation.move('run', 1, 0); assert.equal(animation.advance(0.1).clip, 'run');
  animation.move('idle'); assert.equal(animation.advance(0.1).clip, 'idle');
});
test('dodge and damage override casting, finish once, and return to locomotion', () => {
  const animation = new HeroAnimation(); animation.move('walk');
  animation.trigger('roll'); animation.trigger('cast');
  assert.equal(animation.advance(0.1).clip, 'roll');
  animation.trigger('hit'); assert.equal(animation.advance(0.1).clip, 'hit');
  assert.equal(animation.advance(0.6).clip, 'walk');
  animation.trigger('cast'); assert.equal(animation.advance(0.1).clip, 'cast');
  assert.equal(animation.advance(0.5).clip, 'walk');
});
test('frozen animation holds its frame and replay resets all action state', () => {
  const animation = new HeroAnimation(); animation.trigger('cast');
  const frame = { ...animation.advance(0.1) };
  assert.deepEqual(animation.advance(10, true), frame);
  animation.reset(); assert.deepEqual(animation.advance(0.1), { clip: 'idle', frame: 0, facing: 1 });
});
