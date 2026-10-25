import type { BeatOutcome, BossSpec, EnvironmentId, GameHistory, Player, StoryBeat, Storybook, StorybookPage, StoryProvider } from '../contracts';

/**
 * Phase 1 storyteller: a hand-written branching tale. It exercises every
 * mechanic the engine supports and is the offline fallback if Gemini is
 * unreachable. The Gemini provider implements the same StoryProvider.
 */
export class ScriptedStory implements StoryProvider {
  async begin(party: [Player, Player]): Promise<StoryBeat> {
    const [a, b] = names(party);
    return {
      id: 'intro',
      chapter: 'Chapter I · The Whispering Wood',
      environment: 'forest',
      narration: [
        `Once upon a time, in a kingdom stitched together by starlight, two unlikely heroes named ${a} and ${b} wandered into the Whispering Wood.`,
        `The trees hushed as they passed. Something cold was moving through the branches — the Frost Witch, who had stolen the kingdom's last warm spring.`,
        `"Only those who are brave AND clever may reach my tower," her voice hissed on the wind. "Let us see what you are made of."`,
      ],
    };
  }

  async next(history: GameHistory, last: BeatOutcome): Promise<StoryBeat> {
    const [a, b] = names(history.party);
    if (history.hearts <= 0) return defeatEnding(history);

    const route = routeOf(history);
    const failures = history.outcomes.filter((o) => !o.success && o.kind !== 'vote' && o.kind !== 'story').length;

    switch (last.beatId) {
      case 'intro':
        return {
          id: 'frost-spell',
          chapter: 'Chapter I · The Whispering Wood',
          environment: 'forest',
          speaker: 'The Frost Witch',
          narration: [`A pale mist curls around your ankles. "Move so much as a finger," the Witch whispers, "and my frost will find you."`],
          challenge: { type: 'freeze', prompt: 'Stay perfectly still until the frost passes!', durationSec: 5, tolerance: 0.25 },
        };

      case 'frost-spell':
        if (last.success) {
          return {
            id: 'spirit-gift',
            chapter: 'Chapter I · The Whispering Wood',
            environment: 'forest',
            speaker: 'The Forest Spirit',
            narration: [
              `The frost shatters harmlessly around you. From a hollow oak, a forest spirit glows awake.`,
              `"Such stillness! Take this Moonpetal Charm — the Frost Witch will feel its sting before you ever meet her."`,
            ],
            reward: { kind: 'boss-weaken', name: 'Moonpetal Charm', description: 'The boss begins the battle weakened.' },
          };
        }
        return {
          id: 'shadow-ambush',
          chapter: 'Chapter I · The Whispering Wood',
          environment: 'forest',
          narration: [
            `The curse takes hold! Where the frost touched you, shadows peel away from the trees and take shape — hungry wisps with violet eyes.`,
            `${a}, ${b} — raise your staves and drive them back!`,
          ],
          encounter: { enemy: 'shadow-wisp', count: 5, speed: 1.1 },
        };

      case 'spirit-gift':
      case 'shadow-ambush':
        return {
          id: 'crossroads',
          chapter: 'Chapter II · The Crossroads',
          environment: 'forest',
          narration: [
            last.beatId === 'shadow-ambush' && last.success
              ? `The last wisp fades with a sigh. The wood brightens, and the path ahead splits in two.`
              : `The path ahead splits in two beneath a crooked signpost.`,
            `To the left, the towers of the Rosewater Castle glitter at dusk. To the right, the Crystal Caves hum with a strange blue light. The heroes must decide together.`,
          ],
          challenge: {
            type: 'vote',
            prompt: 'Which way will you go?',
            options: [
              { id: 'castle', label: 'Rosewater Castle' },
              { id: 'cave', label: 'Crystal Caves' },
            ],
            timeLimitSec: 10,
          },
        };

      case 'crossroads': {
        const env: EnvironmentId = last.choiceId === 'cave' ? 'cave' : 'castle';
        const hard = failures > 0;
        return {
          id: 'gate',
          chapter: env === 'castle' ? 'Chapter III · The Rose Gate' : 'Chapter III · The Crystal Door',
          environment: env,
          narration: [
            env === 'castle'
              ? `The castle gate is sealed with a living rose-vine rune. It will open only for heroes who mirror its ancient shapes.`
              : `Deep in the caves, a door of solid crystal blocks the way. Glowing figures are etched into its face — a dance it wants to see.`,
            hard ? `The rune flickers impatiently. It remembers your stumble in the wood, and it will not wait long.` : `Copy each shape exactly, and hold it until the magic accepts you.`,
          ],
          challenge: {
            type: 'pose',
            prompt: 'Copy the shape and hold it!',
            poses: hard ? ['arms-up', 't-pose', 'crouch', 'arms-up'] : ['t-pose', 'arms-up', 'crouch'],
            secondsPerPose: hard ? 4 : 5,
          },
        };
      }

      case 'gate':
        if (!last.success) {
          return {
            id: 'thorn-guard',
            chapter: 'Chapter III · Guardians',
            environment: route,
            narration: [`The magic rejects you with a crack! Thorny imps tumble out of the walls, cackling, to chase the intruders away.`],
            encounter: { enemy: 'thorn-imp', count: 4, speed: 1.2 },
          };
        }
        return showMe(route);

      case 'show-me':
        return lanternFairy(route, last.success ? `The door hums, pleased with what you showed it, and swings open. Beyond it, something small is crying for help.` : `The door sighs and creaks open anyway. Beyond it, something small is crying for help.`);

      case 'thorn-guard':
        return lanternFairy(route, last.success ? `The last imp scampers off. The path is clear — and something small is crying for help.` : `Battered but unbowed, you push past the imps. Nearby, something small is crying for help.`);

      case 'lantern-fairy':
        if (last.choiceId === 'free') {
          return {
            id: 'fairy-joins',
            chapter: 'Chapter IV · The Lantern',
            environment: route,
            speaker: 'Pip the Fairy',
            narration: [`You pry the lantern open and a fairy zooms out in a spiral of sparks. "I'm Pip! The Witch trapped me — let me help you pay her back!"`],
            reward: { kind: 'fairy-ally', name: 'Pip the Fairy', description: 'Pip will fight beside you in the final battle.' },
          };
        }
        return {
          id: 'hurry-on',
          chapter: 'Chapter IV · The Lantern',
          environment: route,
          narration: [
            `There's no time! You hurry past the lantern, and the fairy's cries fade behind you.`,
            `In your haste you nearly trip over a fallen knight's Swiftspark Wand. Its magic crackles eagerly in your hands.`,
          ],
          reward: { kind: 'quick-cast', name: 'Swiftspark Wand', description: 'Your spells recharge twice as fast.' },
        };

      case 'fairy-joins':
      case 'hurry-on':
        return bossBeat(history, route, failures, a, b);

      case 'boss':
        return last.success ? victoryEnding(history) : defeatEnding(history);

      default:
        return defeatEnding(history);
    }
  }

  async storybook(history: GameHistory, victory: boolean): Promise<Storybook> {
    const [a, b] = names(history.party);
    const pages: StorybookPage[] = [
      {
        heading: 'Once Upon a Time',
        text: `In a kingdom stitched together by starlight, ${a} and ${b} set out to win back the last warm spring from the Frost Witch.`,
      },
    ];
    for (const o of history.outcomes) {
      const page = pageFor(o, a, b);
      if (page) pages.push(page);
    }
    const relics = history.relics ?? [];
    if (relics.length) {
      pages.push({
        heading: 'The Reality Rift',
        text: relics.map((r) => `${r.hero === 0 ? a : b} held a real ${r.object} up to the rift, and it became ${r.name}, a ${r.element} weapon that strikes with ${r.ability}.`).join(' '),
      });
    }
    const [sa, sb] = history.stars;
    pages.push({
      heading: victory ? 'Happily Ever After' : 'A Tale Unfinished',
      text: victory
        ? `Warmth flooded back into the kingdom, and every bell rang for ${a} (★ ${sa}) and ${b} (★ ${sb}). Some say the spring still sings their names.`
        : `The frost held fast this time. But ${a} (★ ${sa}) and ${b} (★ ${sb}) are already planning their return — and the Witch knows it.`,
    });
    return { title: `The Tale of ${a} & ${b}`, pages };
  }
}

function names(party: [Player, Player]): [string, string] {
  return [party[0].name, party[1].name];
}

function routeOf(history: GameHistory): EnvironmentId {
  const choice = history.outcomes.find((o) => o.beatId === 'crossroads')?.choiceId;
  return choice === 'cave' ? 'cave' : 'castle';
}

/** Reality Rift: a second door asks the player to show a real object to the webcam. */
function showMe(env: EnvironmentId): StoryBeat {
  const object = env === 'castle' ? 'a book' : 'a bottle or a cup';
  return {
    id: 'show-me',
    chapter: 'Chapter III · The Riddle Door',
    environment: env,
    speaker: 'The Riddle Door',
    narration: [
      `The seal glows gold and swings open, but a second door waits behind it. A pair of carved eyes blinks awake.`,
      `"I have never seen your world," it murmurs. "Show me ${object} from it, and I will let you pass."`,
    ],
    challenge: { type: 'show', prompt: `Show the door ${object}!`, object },
  };
}

function lanternFairy(env: EnvironmentId, opening: string): StoryBeat {
  return {
    id: 'lantern-fairy',
    chapter: 'Chapter IV · The Lantern',
    environment: env,
    narration: [opening, `A tiny fairy is trapped in an iron lantern. Freeing her will take precious time. Leaving her might cost you later.`],
    challenge: {
      type: 'vote',
      prompt: 'Free the fairy, or hurry on?',
      options: [
        { id: 'free', label: 'Free the Fairy' },
        { id: 'hurry', label: 'Hurry On' },
      ],
      timeLimitSec: 10,
    },
  };
}

function bossBeat(history: GameHistory, env: EnvironmentId, failures: number, a: string, b: string): StoryBeat {
  const witch = env === 'castle';
  const boss: BossSpec = witch
    ? { kind: 'frost-witch', name: 'Morwen the Frost Witch', maxHp: 14, attacks: ['frost-gaze', 'shadow-wave'], telegraphSec: 2.2, vulnerableSec: 4 }
    : { kind: 'shadow-dragon', name: 'Umbraxis the Shadow Wyrm', maxHp: 16, attacks: ['shadow-wave', 'frost-gaze'], telegraphSec: 2.2, vulnerableSec: 4 };
  if (failures >= 2) {
    boss.maxHp += 4;
    boss.telegraphSec = 1.7;
  }
  const hasFairy = history.rewards.some((r) => r.kind === 'fairy-ally');
  return {
    id: 'boss',
    chapter: 'Finale · ' + (witch ? 'The Frozen Throne' : 'The Wyrm’s Hoard'),
    environment: env,
    speaker: witch ? 'Morwen the Frost Witch' : 'Umbraxis',
    narration: [
      witch
        ? `"So. ${a} and ${b}." The Frost Witch rises from her throne of ice. "You have come far. You will go no further."`
        : `The cave trembles. From the crystal dark uncoils the Witch's pet — Umbraxis, a wyrm made of living shadow. "${a}... ${b}... I have been so hungry."`,
      failures >= 2
        ? `Every misstep on your journey has fed its power. This will not be easy.`
        : hasFairy
          ? `Pip zips to your shoulder, sparks flying. "Together!" she squeaks.`
          : `Hold your ground, dodge its attacks, and strike when it falters!`,
    ],
    boss,
  };
}

function victoryEnding(history: GameHistory): StoryBeat {
  const [a, b] = names(history.party);
  return {
    id: 'ending-victory',
    chapter: 'The End',
    environment: history.environments[history.environments.length - 1] ?? 'forest',
    narration: [
      `With a final blaze of light, the darkness breaks. Warm wind rushes through the kingdom, and the last spring bubbles up anew.`,
      `And so ${a} and ${b} became legends — not because the story was written for them, but because they wrote it themselves.`,
    ],
    isEnding: true,
  };
}

function defeatEnding(history: GameHistory): StoryBeat {
  const [a, b] = names(history.party);
  return {
    id: 'ending-defeat',
    chapter: 'The End?',
    environment: history.environments[history.environments.length - 1] ?? 'forest',
    narration: [`The frost closes in, and the light of ${a} and ${b}'s staves flickers low.`, `But fairy tales have a way of beginning again...`],
    isEnding: true,
  };
}

function pageFor(o: BeatOutcome, a: string, b: string): StorybookPage | null {
  const both = `${a} and ${b}`;
  switch (o.beatId) {
    case 'frost-spell':
      return {
        heading: 'The Frost Spell',
        text: o.success ? `When the Frost Witch cast her freezing spell, ${both} stood as still as statues, and a forest spirit rewarded them with a Moonpetal Charm.` : `When the Frost Witch cast her freezing spell, ${o.summary.toLowerCase()} — and the curse took hold.`,
      };
    case 'shadow-ambush':
      return { heading: 'The Shadow Wisps', text: o.success ? `Shadow wisps rose from the trees, but ${both} blasted every one of them away without a scratch.` : `Shadow wisps rose from the trees. ${both} fought them off, though not without wounds.` };
    case 'crossroads':
      return { heading: 'The Crossroads', text: o.choiceId === 'cave' ? `At the crossroads, they chose the humming Crystal Caves.` : `At the crossroads, they chose the glittering Rosewater Castle.` };
    case 'gate':
      return { heading: 'The Sealed Door', text: o.success ? `They mirrored the ancient shapes perfectly, and the sealed door opened for them.` : `The ancient shapes proved tricky, and the door's guardians came out to fight.` };
    case 'thorn-guard':
      return { heading: 'The Thorn Imps', text: o.success ? `The thorn imps never laid a claw on them.` : `The thorn imps left a few scratches, but the heroes pressed on.` };
    case 'lantern-fairy':
      return { heading: 'The Lantern', text: o.choiceId === 'free' ? `They stopped to free Pip the fairy from her iron lantern — a kindness she would soon repay.` : `They left the lantern fairy behind and found a Swiftspark Wand instead.` };
    case 'boss':
      return { heading: 'The Final Battle', text: o.success ? `In the final battle, ${both} dodged, ducked and blasted their way to victory. ${o.summary}` : `In the final battle, the darkness proved too strong. ${o.summary}` };
    default:
      return null;
  }
}
