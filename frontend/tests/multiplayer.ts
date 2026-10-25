export {};   // a module, so its names do not clash with globals such as window.status
// Development-only harness for networked play (the presence relay, backend/app/presence.py). Part one talks to the host's
// relay with three real clients, so the relay itself is checked on its own. Part two loads three real games (iframes with
// their own ?presence / ?room / ?name / ?wand) and checks that each shows the other two heroes; it runs once the game's
// presence client exists and is skipped (not failed) before that. ?relay=ws://localhost:8061 picks the relay.
type Msg = Record<string, unknown> & { type?: string };

const status = document.querySelector('#status')!, results = document.querySelector('#results')!;
const relay = new URLSearchParams(location.search).get('relay') ?? 'ws://localhost:8061';
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const notes: string[] = [];

/** One laptop's connection to the relay, with everything it has heard. */
class Client {
  readonly heard: { at: number; msg: Msg }[] = [];
  welcome?: Msg;
  closed = false;
  private constructor(readonly ws: WebSocket, readonly name: string, readonly colour: string) {}
  static open(room: string, name: string, colour: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${relay}/ws/presence/${room}?name=${encodeURIComponent(name)}&colour=${colour}`), client = new Client(ws, name, colour);
      const timer = setTimeout(() => reject(new Error(`${name} got no welcome from ${relay}`)), 4000);
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as Msg; client.heard.push({ at: performance.now(), msg });
        if (msg.type === 'welcome' || msg.type === 'full') { client.welcome = msg; clearTimeout(timer); resolve(client); }
      };
      ws.onclose = () => { client.closed = true; };
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`${name} could not reach ${relay}`)); };
    });
  }
  get id(): number { return this.welcome?.id as number; }
  send(msg: Msg): void { this.ws.send(JSON.stringify(msg)); }
  since(index: number, type: string): Msg[] { return this.heard.slice(index).map((h) => h.msg).filter((m) => m.type === type); }
  async until(predicate: () => boolean, message: string, ms = 2000): Promise<void> {
    const end = performance.now() + ms;
    while (!predicate()) { if (performance.now() > end) throw new Error(message); await wait(10); }
  }
  close(): void { this.ws.close(); }
}

const state = (x: number, extra: Msg = {}): Msg => ({ type: 'state', x, y: 0.5, z: -3, heading: 1, speed: 4.7, anim: 'walk', hp: 3, ...extra });

let running = false;
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  if (running) return; running = true; results.replaceChildren(); notes.length = 0;
  const room = `reh${Date.now() % 1_000_000}`;
  const check = async (name: string, task: () => Promise<void | 'skip'>) => {
    status.textContent = name; const row = document.createElement('li'); results.append(row);
    try {
      const outcome = await task();
      row.textContent = `${outcome === 'skip' ? 'SKIP' : 'PASS'} · ${name}`; row.style.color = outcome === 'skip' ? '#f0d48e' : '#bdedc4';
    } catch (error) { row.textContent = `FAIL · ${name}: ${String(error)}`; row.style.color = '#ffc0b2'; throw error; }
  };
  const clients: Client[] = [];
  try {
    // ---- Part one: the relay ---------------------------------------------------------------------------------------
    let trung!: Client, rishaan!: Client, haicil!: Client;
    await check('Three laptops join: ids 0, 1, 2 in order; each newcomer gets the others; the others hear it join', async () => {
      trung = await Client.open(room, 'Trung', 'red'); clients.push(trung);
      rishaan = await Client.open(room, 'Rishaan', 'blue'); clients.push(rishaan);
      haicil = await Client.open(room, 'haicil', 'yellow'); clients.push(haicil);
      assert(trung.id === 0 && rishaan.id === 1 && haicil.id === 2, `ids ${trung.id}, ${rishaan.id}, ${haicil.id}`);
      const names = (c: Client) => (c.welcome?.peers as Msg[]).map((p) => `${p.name}/${p.colour}`).join(',');
      assert(names(trung) === '' && names(rishaan) === 'Trung/red' && names(haicil) === 'Trung/red,Rishaan/blue', `welcome peers: [${names(trung)}] [${names(rishaan)}] [${names(haicil)}]`);
      await trung.until(() => trung.since(0, 'peer').length === 2, 'Trung did not hear both teammates join');
      const joined = trung.since(0, 'peer').map((m) => `${m.state} ${m.name}/${m.colour}#${m.id}`);
      assert(joined.join(';') === 'joined Rishaan/blue#1;joined haicil/yellow#2', joined.join(';'));
    });

    await check('A fourth laptop is told the game is full and is turned away', async () => {
      const fourth = await Client.open(room, 'Extra', 'red');
      assert(fourth.welcome?.type === 'full', `fourth got ${JSON.stringify(fourth.welcome)}`);
      await fourth.until(() => fourth.closed, 'the fourth connection stayed open');
    });

    await check('The same laptop joining again (a reload, a relaunch, an old tab) takes over its own slot, even in a full room', async () => {
      const marks = [trung.heard.length, rishaan.heard.length];
      const again = await Client.open(room, 'haicil', 'yellow'); clients.push(again);
      assert(again.welcome?.type === 'welcome' && again.id === 2, `the returning laptop got ${JSON.stringify(again.welcome)}`);
      await haicil.until(() => haicil.closed && haicil.heard.some((h) => h.msg.type === 'replaced'), 'the old connection was not told it was replaced, then closed');
      for (const [c, mark] of [[trung, marks[0]], [rishaan, marks[1]]] as const) {
        await c.until(() => c.since(mark, 'peer').length >= 2, `${c.name} did not see haicil leave and come back`);
        const seen = c.since(mark, 'peer').map((m) => `${m.state} ${m.name}#${m.id}`).join(';');
        assert(seen === 'left haicil#2;joined haicil#2', `${c.name} saw ${seen}`);
      }
      haicil = again;
    });

    await check('Moving: a hero\'s state at 12 Hz reaches both others, every message, well within 0.5 s', async () => {
      const marks = [rishaan.heard.length, haicil.heard.length], sent = new Map<number, number>();
      for (let i = 0; i < 18; i++) { const x = 100 + i; sent.set(x, performance.now()); trung.send(state(x)); await wait(83); }
      await wait(300);
      for (const [c, mark] of [[rishaan, marks[0]], [haicil, marks[1]]] as const) {
        const got = c.heard.slice(mark).filter((h) => h.msg.type === 'state');
        assert(got.length === 18, `${c.name} got ${got.length} of 18 state messages`);
        assert(got.every((h) => h.msg.id === trung.id && h.msg.anim === 'walk' && h.msg.hp === 3), `${c.name}: wrong id or fields`);
        const lag = got.map((h) => h.at - sent.get(h.msg.x as number)!).sort((a, b) => a - b), p95 = lag[Math.floor(lag.length * 0.95) - 1];
        assert(p95 < 500, `${c.name}: p95 latency ${p95.toFixed(0)} ms`);
        notes.push(`${c.name} state latency median ${lag[lag.length >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
      }
    });

    await check('Casting and slashing show up on the others (fx with ability and element), and nonsense is dropped', async () => {
      const mark = haicil.heard.length;
      rishaan.send({ type: 'fx', kind: 'cast', x: 1, y: 1, z: 2, dx: 0, dz: -1, ability: 'meteor', element: 'fire' });
      rishaan.send({ type: 'fx', kind: 'slash', x: 1, y: 1, z: 2, dx: 1, dz: 0 });
      rishaan.send({ type: 'fx', kind: 'cast', x: 1, y: 1, z: 2, dx: 0, dz: -1, ability: 'laser', element: 'plasma' });
      rishaan.send({ type: 'fx', kind: 'explode', x: 1, y: 1, z: 2, dx: 0, dz: 0 });
      rishaan.send({ type: 'state', x: 'left', y: 0, z: 0, heading: 0, speed: 0, anim: 'walk', hp: 3 });
      await haicil.until(() => haicil.since(mark, 'fx').length >= 3, 'haicil did not get the effects');
      await wait(200);
      const fx = haicil.since(mark, 'fx').map((m) => `${m.kind}:${m.ability ?? '-'}:${m.element ?? '-'}#${m.id}`);
      assert(fx.join(',') === 'cast:meteor:fire#1,slash:-:-#1,cast:-:-#1', `effects: ${fx.join(',')}`);
      assert(haicil.since(mark, 'state').length === 0, 'a malformed state was passed on');
    });

    await check('One laptop cannot flood the others: about 60 messages a second at most', async () => {
      await wait(1100);   // a fresh one-second window on the relay
      const mark = trung.heard.length;
      for (let i = 0; i < 90; i++) haicil.send(state(i));
      await wait(500);
      const got = trung.since(mark, 'state').length;
      assert(got > 0 && got <= 60, `Trung got ${got} of 90 sent within a second`);
      notes.push(`rate cap: ${got} of 90 burst messages passed`);
    });

    await check('Closing a laptop: the others see it leave, and a new laptop takes the free slot', async () => {
      const marks = [trung.heard.length, haicil.heard.length];
      rishaan.close();
      for (const [c, mark] of [[trung, marks[0]], [haicil, marks[1]]] as const) {
        await c.until(() => c.since(mark, 'peer').some((m) => m.state === 'left'), `${c.name} did not see Rishaan leave`);
        const left = c.since(mark, 'peer').find((m) => m.state === 'left')!;
        assert(left.id === 1 && left.name === 'Rishaan' && left.colour === 'blue', `${c.name} saw ${JSON.stringify(left)}`);
      }
      const back = await Client.open(room, 'Rishaan', 'blue'); clients.push(back);
      assert(back.id === 1, `the returning laptop got id ${back.id}, not the free slot 1`);
    });

    // ---- Part two: three real games -------------------------------------------------------------------------------
    // Each frame is one laptop: a real game (tests/mp-player.html) with its own ?presence / ?room / ?name / ?wand.
    type Avatar = { name: string; colour: string; root: { position: { x: number; z: number } } };
    type PresenceLike = { host: boolean; avatars: Map<string, Avatar>; fxCount: { cast: number; slash: number }; id?: string; update(real: number, time: number, hero: unknown, airborne: boolean): void };
    type GameLike = { time: number; heroes: { root: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void } }; update(dt: number, t: number): void }[]; update(dt: number): void; cast(p: 0): boolean; strike(p: 0): void; airborne: boolean[]; presence?: PresenceLike; spellCooldown: number[]; attackCooldown: number[]; dispose(): void };
    type Laptop = { name: string; colour: string; frame: HTMLIFrameElement; game: () => GameLike; presence: () => PresenceLike | undefined; doc: () => Document };
    const gameRoom = `${room}g`, box = document.querySelector('#players')!;
    const open = (name: string, colour: string, inRoom = gameRoom, hold = false): Laptop => {
      const frame = document.createElement('iframe'); frame.width = '300'; frame.height = '190'; frame.style.border = '1px solid #f0d48e66';
      frame.src = `/tests/mp-player.html?presence=${encodeURIComponent(relay)}&room=${inRoom}&name=${name}&wand=${colour}${hold ? '&hold=1' : ''}`; box.append(frame);
      const sb = () => (frame.contentWindow as unknown as { __storybound?: { game?: GameLike; presence?: PresenceLike; ready?: boolean } } | null)?.__storybound;
      return { name, colour, frame, game: () => sb()!.game!, presence: () => sb()?.presence, doc: () => frame.contentDocument! };
    };
    const ready = (l: Laptop) => !!(l.frame.contentWindow as unknown as { __storybound?: { ready?: boolean } } | null)?.__storybound?.ready;
    /** One game step on every open laptop, as frame() does it, then a real 16 ms so relay messages arrive. */
    const tick = async (laptops: Laptop[], dt = 1 / 60) => {
      for (const l of laptops) {
        const g = l.game(); g.time += dt; g.heroes.forEach((h) => h.update(dt, g.time)); g.update(dt); g.presence?.update(dt, g.time, g.heroes[0], !!g.airborne?.[0]);
      }
      await wait(16);
    };
    const ticksUntil = async (laptops: Laptop[], predicate: () => boolean, max: number) => { for (let n = 0; n <= max; n++) { if (predicate()) return n; await tick(laptops); } return -1; };
    let laptops: Laptop[] = [];

    await check('Three games: each shows the other two heroes with the right name and wand colour', async () => {
      laptops = [open('Trung', 'red'), open('Rishaan', 'blue'), open('haicil', 'yellow')];
      const end = performance.now() + 25000;
      while (!laptops.every(ready)) { if (performance.now() > end) throw new Error('the three games did not start within 25 s'); await wait(200); }
      if (!laptops.every((l) => l.presence()?.avatars)) {
        notes.push('game checks skipped: this build exposes no presence client (window.__storybound.presence)');
        return 'skip';
      }
      const seen = (l: Laptop) => [...l.presence()!.avatars.values()].map((a) => `${a.name}/${a.colour}`).sort().join(',');
      const want = (l: Laptop) => laptops.filter((o) => o !== l).map((o) => `${o.name}/${o.colour}`).sort().join(',');
      const n = await ticksUntil(laptops, () => laptops.every((l) => seen(l) === want(l)), 300);
      assert(n >= 0, `after 5 s: ${laptops.map((l) => `${l.name} sees [${seen(l)}]`).join('; ')}`);
      notes.push(`all three saw each other after ${n} frames`);
    });

    await check('Moving one hero moves it on the other two within 0.5 s', async () => {
      const [a] = laptops, ga = a.game(), p = ga.heroes[0].root.position, id = a.presence()!.id!;
      const to = { x: p.x + 3, z: p.z - 2 };
      p.set(to.x, p.y, to.z);
      const near = (l: Laptop) => { const av = l.presence()!.avatars.get(String(id)); return !!av && Math.hypot(av.root.position.x - to.x, av.root.position.z - to.z) < 0.6; };
      const n = await ticksUntil(laptops, () => laptops.slice(1).every(near), 60);
      const where = laptops.slice(1).map((l) => { const av = l.presence()!.avatars.get(String(id)); return av ? `${l.name}: ${Math.hypot(av.root.position.x - to.x, av.root.position.z - to.z).toFixed(2)} m off` : `${l.name}: no avatar ${id}`; });
      assert(n >= 0 && n <= 30, `Trung's move had not arrived after ${n < 0 ? '60+' : n} frames (${where.join(', ')})`);
      notes.push(`a move arrived in ${n} frames (${(n / 60).toFixed(2)} s)`);
    });

    await check('A cast and a slash on one laptop show up as effects on the other two', async () => {
      const [, b] = laptops, gb = b.game(), others = [laptops[0], laptops[2]];
      const before = others.map((l) => ({ ...l.presence()!.fxCount }));
      gb.spellCooldown[0] = 0; const cast = gb.cast(0); gb.attackCooldown[0] = 0; gb.strike(0);
      assert(cast, 'Rishaan could not cast (the game would not let hero one act)');
      const n = await ticksUntil(laptops, () => others.every((l, i) => l.presence()!.fxCount.cast > before[i].cast && l.presence()!.fxCount.slash > before[i].slash), 60);
      assert(n >= 0, `effects did not arrive: ${others.map((l, i) => `${l.name} cast ${before[i].cast}->${l.presence()!.fxCount.cast}, slash ${before[i].slash}->${l.presence()!.fxCount.slash}`).join('; ')}`);
    });

    const label = (l: Laptop) => l.doc().querySelector('.presence-list strong')?.textContent ?? '';
    const names = (l: Laptop) => [...l.presence()!.avatars.values()].map((a) => a.name).sort().join(',');
    const start = async (l: Laptop, who: string) => {
      const end = performance.now() + 25000;
      while (!ready(l)) { if (performance.now() > end) throw new Error(`${who} did not start`); await wait(200); }
    };
    let fourth: Laptop | undefined, reopened: Laptop | undefined;
    await check('A fourth laptop is told the room is full', async () => {
      fourth = open('Extra', 'red'); await start(fourth, 'the fourth game');
      let text = '';
      for (let i = 0; i < 120 && !text.includes('Room full'); i++) { await tick([...laptops, fourth]); text = label(fourth); }
      assert(text.includes('Room full'), `the fourth laptop shows "${text}"`);
      assert(laptops.every((l) => l.presence()!.avatars.size === 2), 'the turned-away laptop appeared in a game');
    });

    await check('Closing a laptop removes its hero from the other two', async () => {
      const [, , c] = laptops;
      c.game().dispose(); c.frame.remove(); laptops = laptops.slice(0, 2);
      const n = await ticksUntil([...laptops, fourth!], () => laptops.every((l) => !names(l).includes('haicil')), 120);
      assert(n >= 0, `haicil's hero is still there after 2 s: ${laptops.map((l) => `${l.name} sees ${names(l)}`).join('; ')}`);
    });

    await check('The fourth laptop keeps asking and takes the freed slot', async () => {
      const everyone = [...laptops, fourth!];
      const n = await ticksUntil(everyone, () => names(fourth!) === 'Rishaan,Trung' && laptops.every((l) => names(l).includes('Extra')) && label(fourth!) === 'Online', 900);
      assert(n >= 0, `not joined: the fourth shows "${label(fourth!)}" and sees [${names(fourth!)}]; ${laptops.map((l) => `${l.name} sees [${names(l)}]`).join('; ')}`);
    });

    await check('A game opened again by the same player takes over; the old one stops and says why', async () => {
      const [trungGame, oldRishaan] = laptops;
      reopened = open('Rishaan', 'blue'); await start(reopened, 'the reopened game');
      const everyone = [trungGame, oldRishaan, fourth!, reopened];
      const n = await ticksUntil(everyone, () => names(reopened!) === 'Extra,Trung' && names(trungGame) === 'Extra,Rishaan' && names(fourth!) === 'Rishaan,Trung'
        && label(oldRishaan) === 'Playing in another tab' && oldRishaan.presence()!.avatars.size === 0, 600);
      assert(n >= 0, `the reopened game sees [${names(reopened)}], Trung [${names(trungGame)}], Extra [${names(fourth!)}]; the old one shows "${label(oldRishaan)}" with ${oldRishaan.presence()!.avatars.size} heroes`);
      // It stays stopped: no reconnect takes the slot back from the newer game.
      await ticksUntil(everyone, () => false, 90);
      assert(label(oldRishaan) === 'Playing in another tab' && names(trungGame) === 'Extra,Rishaan', `afterwards the old one shows "${label(oldRishaan)}", Trung sees [${names(trungGame)}]`);
    });
    [...laptops, fourth, reopened].forEach((l) => { if (!l) return; try { l.game().dispose(); } catch { /* already gone */ } l.frame.remove(); });

    // ---- Part three: fighting together (one start, shared hits on the wave and the boss) ---------------------------
    type Foe = { netId?: string; hp: number; maxHp: number };
    type Fighter = GameLike & { enemies: Foe[]; demo?: unknown; startWave(): void; hit(e: Foe, damage: number, player: 0): void };
    const fighter = (l: Laptop) => l.game() as unknown as Fighter;
    const waiting = (l: Laptop) => !!(l.frame.contentWindow as unknown as { __storybound?: { waiting?: boolean } } | null)?.__storybound?.waiting;
    let team: Laptop[] = [];
    await check('Starting the run on one laptop starts it on the others, even one that joins later', async () => {
      const fightRoom = `${room}f`;
      team = [open('Trung', 'red', fightRoom), open('Rishaan', 'blue', fightRoom, true)];
      const end = performance.now() + 25000;
      while (!(ready(team[0]) && (waiting(team[1]) || ready(team[1])))) { if (performance.now() > end) throw new Error('the games did not load'); await wait(200); }
      while (!ready(team[1])) { if (performance.now() > end) throw new Error('Rishaan, waiting on the start screen, was not started by Trung'); await wait(200); }
      const late = open('haicil', 'yellow', fightRoom, true); team.push(late);
      while (!ready(late)) { if (performance.now() > end + 15000) throw new Error('haicil, joining after the start, was not started'); await wait(200); }
    });

    await check('A hit on one laptop lands on the same foe on the others, and waits for a foe not spawned yet', async () => {
      if (!fighter(team[0]).demo) { notes.push('fight checks skipped: no demo run in this build'); return 'skip'; }
      const [a, b, c] = team.map(fighter);
      a.startWave(); b.startWave();
      const foe = (g: Fighter, id: string) => g.enemies.find((e) => e.netId === id);
      assert(foe(a, 'e0') && foe(b, 'e0'), `no shared ids: ${a.enemies.map((e) => e.netId).join(',')}`);
      const full = foe(b, 'e0')!.hp;
      a.hit(foe(a, 'e0')!, 2, 0); a.hit(foe(a, 'e1')!, 3, 0);
      let n = await ticksUntil(team, () => foe(b, 'e0')!.hp === full - 2 && foe(b, 'e1')!.hp === full - 3, 60);
      assert(n >= 0, `Rishaan's e0 has ${foe(b, 'e0')!.hp} of ${full}, e1 ${foe(b, 'e1')!.hp}`);
      b.hit(foe(b, 'e0')!, full, 0);
      n = await ticksUntil(team, () => foe(a, 'e0')!.hp <= 0, 60);
      assert(n >= 0, `Trung's e0 still has ${foe(a, 'e0')!.hp} after Rishaan killed it`);
      c.startWave();
      const got = (c.enemies.find((e) => e.netId === 'e0')?.hp ?? NaN), got1 = (c.enemies.find((e) => e.netId === 'e1')?.hp ?? NaN);
      n = await ticksUntil(team, () => (foe(c, 'e0')?.hp ?? 1) <= 0 && foe(c, 'e1')?.hp === full - 3, 60);
      assert(n >= 0, `haicil, reaching the wave last: e0 ${foe(c, 'e0')?.hp} (at spawn ${got}), e1 ${foe(c, 'e1')?.hp} (at spawn ${got1})`);
    });
    await check('Everyone sees the host\'s foes where the host\'s are', async () => {
      if (!fighter(team[0]).demo) return 'skip';
      const host = team.find((l) => l.presence()!.host)!, followers = team.filter((l) => l !== host), h = fighter(host);
      const foe = (g: Fighter, id: string) => (g.enemies as (Foe & { root?: { position: { x: number; z: number; set(x: number, y: number, z: number): void } } })[]).find((e) => e.netId === id && e.hp > 0);
      const live = h.enemies.find((e) => e.netId && e.hp > 0)!; const id = live.netId!;
      const hp = foe(h, id)!.root!.position; hp.set(hp.x + 4, 0, hp.z - 3);
      const at = () => ({ x: foe(h, id)!.root!.position.x, z: foe(h, id)!.root!.position.z });
      const near = (l: Laptop) => { const f = foe(fighter(l), id); return !!f && Math.hypot(f.root!.position.x - at().x, f.root!.position.z - at().z) < 0.8; };
      const n = await ticksUntil(team, () => followers.every(near), 120);
      assert(n >= 0, `${id}: host at ${JSON.stringify(at())}; ${followers.map((l) => { const f = foe(fighter(l), id); return `${l.name} at ${f ? `${f.root!.position.x.toFixed(1)},${f.root!.position.z.toFixed(1)}` : 'none'}`; }).join('; ')}`);
      notes.push(`followers matched the host's ${id} in ${n} frames`);
    });
    team.forEach((l) => { try { l.game().dispose(); } catch { /* already gone */ } l.frame.remove(); });

    status.textContent = `Done. ${notes.join(' · ')}`; document.body.dataset.result = 'passed';
  } catch (error) { status.textContent = `${String(error)} ${notes.join(' · ')}`; document.body.dataset.result = 'failed'; console.error(error); }
  finally { clients.forEach((c) => c.close()); running = false; }
};
