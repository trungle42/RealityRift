# Dev 1 verification — October 24, 2026

Scope: the Game Development / Visuals responsibilities listed on pages 6–7 of
the supplied HackTX brief. Work was performed on `dev1/game-visuals`.

| Dev 1 responsibility | Implemented and checked |
| --- | --- |
| Game environment and interface | Forest, castle and cavern artwork; responsive title and party screens; chapter, shared-heart and individual-star HUD; readable narration; controls guide and storybook. |
| Animations and visual effects | Four rendered poses per hero, pose transitions, idle breathing, spell bolts, contact shadows, drifting mist, light rays, ambient particles, frost, damage feedback and boss wards. |
| Enemy and boss encounters | Shadow wisps and thorn imps; frost queen and shadow dragon; advance warnings, freeze and crouch attacks, protected/vulnerable phases, player spells, fairy ally and reward effects. |
| Hearts, scoring and progression | Three shared hearts, individual stars, branching castle/cave routes, performance consequences, rewards, boss victory/defeat, personalized scripted storybook, fresh replay state. |

## Correctness fixes

- Boss outcomes now report actual hearts lost instead of always reporting zero.
- Missing players cannot pass freeze or pose checks, or dodge a shadow wave,
  using stale tracking data. This consumes the existing `InputSource.present`
  flag; it does not implement computer vision.
- Encounter processing stops damaging the party at zero hearts. Late spell
  impacts cannot award stars or damage a boss after defeat/encounter cleanup.
- A victory ending requires a successful boss outcome and remaining hearts.
- Story history passed to a provider is a deep snapshot, so provider-side changes
  cannot mutate live player, reward or per-player outcome state.
- Heart restoration and loss obey the three-heart cap and terminal defeat state.
- Long narration is paginated to the measured text area; hero names and chapter
  headings fit their allotted space. The speaker label clears both hero names.
- The controls dialog pauses the clock; its buttons do not also advance narration.
- Spell bolts and shadow waves use Pixi containers rather than adding children
  to sprites, removing the observed rendering deprecation warning.
- Artwork loading has progress feedback and a retry screen for load failures.

## Validation

- `npm test`: 14 passing tests covering state boundaries, history isolation,
  missing tracking, reward math, victory rules, both routes with both fairy
  choices, failure consequences, storybook output and replay isolation.
- `npm run build`: strict TypeScript check (including browser test sources) and
  Vite production build passed.
- Browser engine harness: 11 scenarios passed, plus replay reset. Includes
  successful and failed freeze/pose challenges, voting agreement and timeout,
  enemy victory and defeat, both boss victories, fairy/quick-cast/charm rewards,
  boss defeat accounting, and actor/input-listener cleanup.
- The full engine suite was rerun after correcting the Pixi warning. No new
  browser errors or warnings were recorded in that run.
- Production browser smoke test: title, keyboard activation, two-name party
  setup, narration advancement, voice toggle and controls dialog.
- Visual checks at a narrow 643×604 viewport and a 1280×720 viewport; forest,
  castle and cavern previews inspected with the rendered actors.

These checks cover the implemented Dev 1 portion, not an assertion that every
possible browser/device or future provider integration has been tested.

## Integration boundaries

The frontend still starts with `ScriptedStory` and `KeyboardInput`. Live Gemini
generation (Dev 2) and MediaPipe/webcam/hardware input (Dev 3) are not connected
on this branch. The `StoryProvider` and `InputSource` interfaces remain the
handoff points. The backend's event/catalog format on `dev-2` differs from the
frontend's `StoryBeat` format, so Dev 2 needs an explicit client adapter/catalog
mapping; simply swapping the URL is insufficient.

Real-world object artifacts and other stretch features are not part of this
Dev 1 completion claim. The visual system is 2.5D with rendered assets and
layered effects, not real-time 3D meshes or a movable 3D camera.
