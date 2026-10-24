import { Container, Graphics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import type { EnvironmentId, PlayerIndex, StoryBeat } from '../contracts';
import { now, onFrame, setPaused } from '../core/clock';
import type { Stage } from '../game/Stage';
import { GROUND_Y, HERO_X, palette } from '../theme';
import { Enemy } from '../world/Enemy';
import { CampaignProgress, questFor, REGIONS, type Landmark } from './locations';
import { depthScale, distance, findPath, move, type Point } from './navigation';
import { landmarkView, pillar } from './props';

interface Roamer { id: string; actor: Enemy; home: Point; hp: number; windup: number; cooldown: number; target: PlayerIndex }
const MOVE_KEYS = [['KeyA', 'KeyD', 'KeyW', 'KeyS'], ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']];

/** Exploration owns its listeners and scenery only while a story objective is active. */
export class Campaign {
  readonly progress = new CampaignProgress();
  private readonly positions = new Map<EnvironmentId, [Point, Point]>();
  private following = true;

  constructor(private readonly stage: Stage) {}

  async explore(beat: StoryBeat): Promise<boolean> {
    const stage = this.stage, progress = this.progress, quest = questFor(beat);
    progress.unlock(beat);
    stage.exploring = true;
    stage.heroes.forEach((h) => { h.setPose(null); h.setWalking(false); });
    const keys = new Set<string>();
    const paths: [Point[], Point[]] = [[], []];
    const cooldown = [0, 0], dash = [0, 0], dashCooldown = [0, 0];
    const directions: [Point, Point] = [{ x: 1, y: 0 }, { x: 1, y: 0 }];
    let companionManualUntil = 0, followTimer = 0, invulnerable = 0;
    let busy = true, finished = false, nearest: Landmark | undefined, pending: Landmark | undefined;
    let landmarks: Landmark[] = [], objects: Container[] = [], enemies: Roamer[] = [];
    let active = true, messageUntil = 0, mapTimer = 0;
    let resolve!: (value: boolean) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    const ground = new Container(); ground.eventMode = 'static'; ground.cursor = 'crosshair';
    ground.label = 'campaign-ground';
    ground.hitArea = new Rectangle(65, 365, 1150, 285); ground.zIndex = -100;
    const route = new Graphics(); route.zIndex = -90; route.eventMode = 'none';
    stage.actors.addChild(ground, route);

    const overlay = document.createElement('section'); overlay.className = 'campaign';
    overlay.setAttribute('aria-label', 'Campaign exploration');
    overlay.setAttribute('aria-busy', 'true');
    overlay.innerHTML = `<div class="campaign-quest"><span class="eyebrow">THE STOLEN SPRING</span><h2></h2><p></p></div>
      <div class="campaign-map"><div class="campaign-region"></div><svg viewBox="60 360 1160 300" role="img" aria-label="Local map: gold is your quest, green and amber are your heroes"></svg><button type="button" class="journal-button">Journal & world map <kbd>Q</kbd></button></div>
      <div class="campaign-toast" role="status" aria-live="polite"></div>
      <div class="campaign-actions"><button type="button" class="interact-button" disabled>Walk toward a landmark <kbd>E</kbd></button><button type="button" class="cast-button">Cast <kbd>F</kbd></button><button type="button" class="dash-button">Dodge <kbd>Shift</kbd></button></div>
      <div class="campaign-footer"><span><kbd>W A S D</kbd> move · click to walk · hold <kbd>Space</kbd> to run · <kbd>↑ ↓ ← →</kbd> hero two</span><button type="button" class="follow-button"></button></div>`;
    const title = overlay.querySelector('h2')!, subtitle = overlay.querySelector('.campaign-quest p')!;
    title.textContent = quest.name;
    const regionLabel = overlay.querySelector('.campaign-region')!;
    const map = overlay.querySelector('svg')!;
    const context = overlay.querySelector<HTMLButtonElement>('.interact-button')!;
    const toast = overlay.querySelector<HTMLElement>('.campaign-toast')!;
    const followButton = overlay.querySelector<HTMLButtonElement>('.follow-button')!;
    const dialog = document.createElement('dialog'); dialog.className = 'controls-dialog campaign-journal';
    dialog.setAttribute('aria-label', 'Adventure journal');
    document.body.append(overlay, dialog);

    const syncFollow = () => { followButton.textContent = `Companion follows · ${this.following ? 'on' : 'off'}`; followButton.setAttribute('aria-pressed', String(this.following)); };
    syncFollow();
    const tell = (text: string) => { toast.textContent = text; toast.classList.add('visible'); messageUntil = now() + 5; };
    const remember = () => this.positions.set(progress.region, stage.heroes.map((h) => ({ x: h.x, y: h.y })) as [Point, Point]);
    const clearObjects = () => { objects.forEach((o) => o.destroy({ children: true })); objects = []; enemies.forEach((e) => { if (!e.actor.destroyed) e.actor.destroy({ children: true }); }); enemies = []; };
    const fail = (error: unknown) => { finished = true; reject(error); };
    const finish = (success: boolean) => { if (finished) return; finished = true; remember(); resolve(success); };
    const modal = (heading: string, text: string) => {
      keys.clear(); paths[0] = []; paths[1] = [];
      dialog.replaceChildren();
      const h = document.createElement('h2'); h.textContent = heading;
      const p = document.createElement('p'); p.textContent = text;
      const close = document.createElement('button'); close.className = 'primary-button'; close.textContent = 'Return to the world'; close.onclick = () => dialog.close();
      dialog.append(h, p, close); stage.narrator.stop(); setPaused(true); dialog.showModal();
    };
    dialog.addEventListener('close', () => { keys.clear(); setPaused(false); });

    const journal = () => {
      if (busy || finished || document.querySelector('dialog[open]')) return;
      modal('The stolen spring', `Current quest: ${quest.name}. Travel to ${REGIONS[beat.environment].name} and approach the golden beacon. Your adventure pauses while the journal is open.`);
      const regions = document.createElement('div'); regions.className = 'journal-regions';
      for (const [id, region] of Object.entries(REGIONS)) {
        const card = document.createElement('article');
        card.className = progress.unlocked.has(id as EnvironmentId) ? 'unlocked' : '';
        const heading = document.createElement('h3'); heading.textContent = region.name;
        const description = document.createElement('p');
        description.textContent = `${progress.region === id ? 'You are here' : progress.unlocked.has(id as EnvironmentId) ? 'Crossing open' : 'Locked until your story leads here'}${beat.environment === id ? ' · Active quest' : ''}`;
        card.append(heading, description); regions.append(card);
      }
      const inventory = document.createElement('p');
      inventory.textContent = `Treasures found: ${[...progress.collected].filter((id) => id.endsWith(':chest')).length} · Guardians defeated: ${progress.defeated.size}. Relics: ${stage.state.rewards.map((r) => r.name).join(', ') || 'None yet'}.`;
      const completed = document.createElement('p'); completed.textContent = `Completed: ${progress.completed.join(' → ') || 'Your journey has just begun.'}`;
      const instructions = document.createElement('p'); instructions.textContent = 'Explore at your own pace. Chests award stars to both heroes. Springs restore one shared heart once per area. F (or / for Hero Two) casts at a nearby enemy. Left / right Shift dodges for that hero. Click a landmark to walk toward it, then press E or click Interact. Arrows take control of your companion.';
      dialog.insertBefore(regions, dialog.lastElementChild); dialog.insertBefore(inventory, dialog.lastElementChild); dialog.insertBefore(completed, dialog.lastElementChild); dialog.insertBefore(instructions, dialog.lastElementChild);
    };

    const cast = (player: PlayerIndex) => {
      if (busy || finished || cooldown[player] > 0 || document.querySelector('dialog[open]')) return;
      const hero = stage.heroes[player];
      const enemy = enemies.filter((e) => e.hp > 0 && distance(e.actor, hero) < 310).sort((a, b) => distance(a.actor, hero) - distance(b.actor, hero))[0];
      if (!enemy) { tell('No enemy in range. Move closer to a shadow guardian.'); return; }
      cooldown[player] = stage.state.has('quick-cast') ? 0.3 : 0.65;
      const from = hero.cast(); stage.sfx.zap();
      // Reserve the hit now; an in-flight spell cannot score a second kill.
      enemy.hp--;
      void stage.fx.bolt(from.x, from.y, enemy.actor.x, enemy.actor.y - 55, hero.color, 0.25).then(() => {
        if (!active || finished || stage.state.defeated || enemy.actor.destroyed) return;
        stage.sfx.impact();
        if (enemy.hp <= 0) {
          progress.defeated.add(enemy.id); enemy.actor.dissolve(stage.fx); stage.awardStar(player, 2);
          tell('Guardian dispelled · +2 stars. This clearing is safe.');
        }
      }).catch(fail);
    };
    const dodge = (player: PlayerIndex) => {
      if (busy || finished || dashCooldown[player] > 0 || document.querySelector('dialog[open]')) return;
      dash[player] = 0.22; dashCooldown[player] = 1.25;
      stage.heroes[player].dodge();
      stage.fx.ring(stage.heroes[player].x, stage.heroes[player].y, stage.heroes[player].color, 45);
    };

    const walkTo = (target: Point, item?: Landmark) => {
      if (busy || finished || document.querySelector('dialog[open]')) return;
      paths[0] = findPath(stage.heroes[0], target, REGIONS[progress.region].obstacles);
      pending = item;
      route.clear();
      if (paths[0].length) {
        route.moveTo(stage.heroes[0].x, stage.heroes[0].y);
        for (const p of paths[0]) route.lineTo(p.x, p.y);
        route.stroke({ color: palette.gold, alpha: 0.3, width: 2 });
        route.ellipse(paths[0].at(-1)!.x, paths[0].at(-1)!.y, 16, 5).stroke({ color: palette.gold, alpha: 0.9, width: 2 });
      }
    };

    const render = () => {
      clearObjects();
      const region = REGIONS[progress.region];
      landmarks = [...region.landmarks];
      if (progress.region === beat.environment) landmarks.push(quest);
      for (const obstacle of region.obstacles) {
        const view = pillar(obstacle.x, obstacle.y, obstacle.radius, progress.region === 'cave'); stage.actors.addChild(view); objects.push(view);
      }
      for (const item of landmarks) {
        const used = progress.collected.has(`${progress.region}:${item.id}`);
        const locked = !!item.destination && !progress.unlocked.has(item.destination);
        const view = landmarkView(item, used, locked);
        view.label = `landmark:${item.id}`;
        view.on('pointertap', (e: FederatedPointerEvent) => { e.stopPropagation(); walkTo(item, item); });
        stage.actors.addChild(view); objects.push(view);
      }
      const enemyId = `${progress.region}:guardian`;
      if (beat.id !== 'intro' && !progress.defeated.has(enemyId)) {
        const home = progress.region === 'forest' ? { x: 960, y: 620 } : progress.region === 'castle' ? { x: 1100, y: 575 } : { x: 1040, y: 435 };
        const actor = new Enemy(progress.region === 'castle' ? 'thorn-imp' : 'shadow-wisp');
        actor.position.copyFrom(home); actor.scale.set(0.65); actor.zIndex = home.y;
        actor.eventMode = 'static'; actor.cursor = 'crosshair';
        actor.on('pointertap', (e: FederatedPointerEvent) => { e.stopPropagation(); cast(0); });
        stage.actors.addChild(actor); enemies.push({ id: enemyId, actor, home, hp: 2, windup: 0, cooldown: 1, target: 0 });
      }
      regionLabel.textContent = region.name;
      subtitle.textContent = progress.region === beat.environment ? 'Explore the clearing · follow the golden beacon' : `Take the crossing to ${REGIONS[beat.environment].name}`;
      mapTimer = 1;
    };

    const refreshLandmark = (item: Landmark) => {
      const old = objects.find((o) => o.label === `landmark:${item.id}`);
      if (old) { old.destroy({ children: true }); objects = objects.filter((o) => o !== old); }
      const view = landmarkView(item, true, false); view.label = `landmark:${item.id}`;
      view.on('pointertap', (e: FederatedPointerEvent) => { e.stopPropagation(); walkTo(item, item); });
      stage.actors.addChild(view); objects.push(view);
    };
    const travel = async (destination: EnvironmentId, initial = false) => {
      overlay.setAttribute('aria-busy', 'true');
      busy = true; keys.clear(); paths[0] = []; paths[1] = []; pending = undefined; nearest = undefined; route.clear();
      if (!initial) remember();
      stage.heroes.forEach((h) => h.setWalking(false)); clearObjects();
      await stage.setEnvironment(destination);
      progress.region = destination;
      const positions = this.positions.get(destination) ?? [{ x: 245, y: 540 }, { x: 330, y: 565 }];
      stage.heroes.forEach((h, i) => { h.position.copyFrom(positions[i]); h.scale.set(depthScale(h.y)); h.zIndex = h.y; });
      render(); busy = false; invulnerable = 2;
      overlay.setAttribute('aria-busy', 'false');
      tell(`${REGIONS[destination].name} · ${REGIONS[destination].subtitle}`);
    };

    const interact = () => {
      if (busy || finished || !nearest || document.querySelector('dialog[open]')) return;
      const item = nearest, id = `${progress.region}:${item.id}`;
      keys.clear(); paths[0] = []; paths[1] = []; route.clear(); pending = undefined;
      if (item.kind === 'quest') { progress.completed.push(item.name); finish(true); }
      else if (item.kind === 'portal') {
        if (!progress.unlocked.has(item.destination!)) tell('This crossing is sealed. Follow your current quest to open a path.');
        else void travel(item.destination!).catch(fail);
      } else if (item.kind === 'chest') {
        if (!progress.claim(id)) { tell('You have already opened this cache.'); return; }
        stage.awardStar(0, 2); stage.awardStar(1, 2); stage.sfx.chime();
        tell('Treasure discovered · +2 stars for each hero.'); refreshLandmark(item);
      } else if (item.kind === 'shrine') {
        if (progress.collected.has(id)) { tell('This spring has given its magic. Seek another spring.'); return; }
        if (stage.state.hearts >= 3) { tell('Your hearts are full. The spring will wait until you need it.'); return; }
        if (progress.claim(id)) { stage.gainHeart(); stage.sfx.chime(); tell('The spring restores one shared heart.'); refreshLandmark(item); }
      } else {
        progress.claim(id); modal(item.name, item.detail ?? 'Follow the golden light.');
      }
    };

    const blocked = () => !!document.querySelector('dialog[open]');
    const down = (e: KeyboardEvent) => {
      if (blocked() || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) { keys.clear(); return; }
      if (busy || finished) return;
      if (e.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Slash', 'ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) e.preventDefault();
      keys.add(e.code);
      if (MOVE_KEYS[0].includes(e.code)) { paths[0] = []; pending = undefined; route.clear(); }
      if (MOVE_KEYS[1].includes(e.code)) { paths[1] = []; companionManualUntil = now() + 4; }
      if (e.repeat) return;
      if (e.code === 'KeyE') interact();
      if (e.code === 'KeyQ') journal();
      if (e.code === 'KeyF') cast(0);
      if (e.code === 'Slash') cast(1);
      if (e.code === 'ShiftLeft') dodge(0);
      if (e.code === 'ShiftRight') dodge(1);
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.code); };
    const blur = () => { keys.clear(); paths[0] = []; paths[1] = []; route.clear(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    const visibility = () => { if (document.hidden) blur(); };
    document.addEventListener('visibilitychange', visibility);
    ground.on('pointertap', (e: FederatedPointerEvent) => walkTo(e.getLocalPosition(stage.actors)));
    overlay.querySelector('.journal-button')!.addEventListener('click', journal);
    context.addEventListener('click', interact);
    overlay.querySelector('.cast-button')!.addEventListener('click', () => cast(0));
    overlay.querySelector('.dash-button')!.addEventListener('click', () => dodge(0));
    followButton.addEventListener('click', () => { this.following = !this.following; paths[1] = []; syncFollow(); });

    const off = onFrame((dt) => {
      overlay.style.left = `${stage.root.x}px`; overlay.style.top = `${stage.root.y}px`;
      overlay.style.transform = `scale(${stage.root.scale.x})`;
      if (busy || finished) return;
      if (blocked()) { blur(); return; }
      if (stage.state.defeated) { finish(false); return; }
      invulnerable = Math.max(0, invulnerable - dt);
      const obstacles = REGIONS[progress.region].obstacles;
      followTimer -= dt;
      if (this.following && now() > companionManualUntil && distance(stage.heroes[0], stage.heroes[1]) > 105 && followTimer <= 0) {
        paths[1] = findPath(stage.heroes[1], stage.heroes[0], obstacles); followTimer = 0.6;
      }
      stage.heroes.forEach((hero, i) => {
        cooldown[i] = Math.max(0, cooldown[i] - dt); dashCooldown[i] = Math.max(0, dashCooldown[i] - dt);
        const k = MOVE_KEYS[i];
        let dx = Number(keys.has(k[1])) - Number(keys.has(k[0]));
        let dy = Number(keys.has(k[3])) - Number(keys.has(k[2]));
        if (i === 1 && (dx || dy)) companionManualUntil = now() + 4;
        if (!dx && !dy && paths[i].length) {
          if (i === 1 && this.following && distance(hero, stage.heroes[0]) < 75) paths[i] = [];
          while (paths[i].length && distance(hero, paths[i][0]) < 7) paths[i].shift();
          const target = paths[i][0];
          if (target) { dx = target.x - hero.x; dy = target.y - hero.y; }
        }
        const len = Math.hypot(dx, dy);
        if (len) { dx /= len; dy /= len; directions[i] = { x: dx, y: dy }; }
        const dashing = dash[i] > 0;
        if (dashing) { dx = directions[i].x; dy = directions[i].y; }
        const running = keys.has('Space') || (i === 1 && this.following && paths[1].length > 0 && distance(hero, stage.heroes[0]) > 180);
        const speed = dashing ? 480 : running ? 285 : 185;
        const next = move(hero, dx * speed * dt, dy * speed * dt * 0.75, obstacles);
        const moving = distance(hero, next) > 0.1;
        hero.position.copyFrom(next); hero.scale.set(depthScale(hero.y)); hero.zIndex = hero.y;
        hero.setMovement(moving ? running ? 'run' : 'walk' : 'idle', dx, dy);
        hero.alpha = invulnerable > 0 ? 0.65 + Math.sin(now() * 20) * 0.2 : 1;
        dash[i] = Math.max(0, dash[i] - dt);
      });
      if (!paths[0].length) route.clear();
      nearest = landmarks.filter((l) => stage.heroes.some((h) => distance(h, l) < 85)).sort((a, b) => {
        if (pending?.id === a.id) return -1; if (pending?.id === b.id) return 1;
        return Math.min(...stage.heroes.map((h) => distance(h, a))) - Math.min(...stage.heroes.map((h) => distance(h, b)));
      })[0];
      const action = nearest ? `${nearest.kind === 'portal' ? 'Travel to' : nearest.kind === 'chest' ? 'Open' : nearest.kind === 'shrine' ? 'Drink from' : nearest.kind === 'lore' ? 'Speak to' : 'Begin'} ${nearest.name}  [E]` : 'Walk toward a landmark  [E]';
      if (context.textContent !== action) context.textContent = action;
      context.disabled = !nearest;
      if (now() > messageUntil) toast.classList.remove('visible');
      for (const e of enemies) {
        if (e.hp <= 0 || e.actor.destroyed) continue;
        e.actor.animate(); e.cooldown = Math.max(0, e.cooldown - dt);
        const player = (distance(e.actor, stage.heroes[0]) < distance(e.actor, stage.heroes[1]) ? 0 : 1) as PlayerIndex;
        const target = stage.heroes[player];
        if (e.windup > 0) {
          e.windup -= dt; e.actor.tint = Math.floor(now() * 10) % 2 ? 0xffa19b : 0xffffff;
          if (e.windup <= 0) {
            e.actor.tint = 0xffffff; e.cooldown = 1.8;
            const victim = stage.heroes[e.target];
            stage.fx.ring(e.actor.x, e.actor.y, 0xe87978, 48);
            if (distance(e.actor, victim) < 58 && dash[e.target] <= 0 && invulnerable <= 0) {
              stage.loseHeart(); invulnerable = 2.5;
              victim.recoil();
              tell('A shadow strike! Step away from the red warning, or press Shift to dodge.');
              if (stage.state.defeated) { finish(false); break; }
            }
          }
        } else if (distance(e.actor, target) < 48 && e.cooldown <= 0) {
          e.windup = 0.85; e.target = player;
          stage.fx.ring(e.actor.x, e.actor.y, 0xff8585, 55);
        } else {
          const chase = distance(e.actor, target) < 185;
          const goal = chase ? target : { x: e.home.x + Math.sin(now() * 0.5) * 40, y: e.home.y + Math.cos(now() * 0.6) * 14 };
          const len = distance(e.actor, goal);
          if (len > 5) e.actor.position.copyFrom(move(e.actor, (goal.x - e.actor.x) / len * (chase ? 62 : 30) * dt, (goal.y - e.actor.y) / len * 45 * dt, obstacles));
        }
        e.actor.zIndex = e.actor.y; e.actor.scale.set(depthScale(e.actor.y) * 0.9);
      }
      mapTimer += dt;
      if (mapTimer > 0.12) {
        mapTimer = 0;
        // Only numeric world coordinates are interpolated into the map markup.
        map.innerHTML = `<path d="M180 395 L1100 395 L1180 640 L95 640 Z" fill="#173b2d" stroke="#abc7a5" stroke-opacity=".25" stroke-width="5"/>` +
          landmarks.map((l) => `<circle cx="${l.x}" cy="${l.y}" r="${l.kind === 'quest' ? 18 : 11}" fill="${l.kind === 'quest' ? '#ecd18e' : l.kind === 'portal' && !progress.unlocked.has(l.destination!) ? '#53685e' : '#a0cbbd'}"/>`).join('') +
          enemies.filter((e) => e.hp > 0).map((e) => `<circle cx="${e.actor.x}" cy="${e.actor.y}" r="12" fill="#f49898"/>`).join('') +
          stage.heroes.map((h, i) => `<circle cx="${h.x}" cy="${h.y}" r="17" fill="${i ? '#eebd87' : '#8ee3c4'}" stroke="#fff" stroke-width="4"/>`).join('');
      }
    });

    try {
      await stage.backdrop.setExploration(true);
      await travel(progress.region, true);
      tell(beat.id === 'intro' ? 'Welcome, wayfarers. Move with WASD or click the path. Approach the golden waystone and press E.' : `New quest · ${quest.name}`);
      return await completion;
    } finally {
      active = false; off(); keys.clear();
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      if (dialog.open) dialog.close();
      overlay.remove(); dialog.remove(); ground.destroy(); route.destroy(); clearObjects();
      stage.exploring = false;
      stage.heroes.forEach((h, i) => { h.resetAnimation(); h.alpha = 1; h.scale.set(1); h.position.set(HERO_X[i], GROUND_Y); h.zIndex = GROUND_Y + i; });
      await stage.backdrop.setExploration(false);
    }
  }
}
