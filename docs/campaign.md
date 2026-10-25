# Storybound — interactive campaign

The Dev 1 game now has freely explorable clearings between story encounters.
Explore the Whispering Wood, choose a route to Rosewater Castle or the Crystal
Caves, and return through unlocked crossings. The golden beacon marks the next
story objective; approaching it and interacting starts that encounter.

## Playing

| Action | Controls |
| --- | --- |
| Move Hero One | WASD or click the ground |
| Move Hero Two | Arrow keys; automatic following can be toggled |
| Run | Hold Space while moving |
| Interact | E or the contextual button |
| Exploration spell | F for Hero One, / for Hero Two; clicking an enemy casts for Hero One |
| Dodge roll | Left Shift for Hero One, right Shift for Hero Two |
| Journal, map, relics | Q or Journal & world map |
| Story narration | Space / Enter |
| Story encounter spells | W / Up Arrow |
| Pose challenges | Hero One: 1 / 2 / 3. Hero Two: I / O / P |

Clicking a landmark routes your ranger toward it; press E when close enough.
Both players share three hearts. Treasure gives each player two stars. Springs
restore one heart and are only consumed when healing is needed. Roaming guardians
take two spells, warn before striking, and stay defeated after you leave.

Both heroes use five-frame cycles for walking, walking away from the camera,
running, dodge rolls, casting and taking damage. The engine also animates idle
breathing, celebration, shadows, spell trails and environmental effects.

The world uses fixed-view 2.5D scenery and sprites. The camera does not orbit.
The adventure is keyboard/mouse controlled; live Gemini and webcam integration
remain separate Dev 2 / Dev 3 work. Progress is kept during the current adventure,
including backtracking; browser refresh starts a new adventure.

## Verification

- `npm test`: 22 rule, navigation, branching-story and animation-state tests.
- `npm run build`: strict TypeScript check and production bundle.
- `/tests/campaign.html`: real rendered campaign integration scenarios.
- `/tests/playthrough.html`: existing challenge and boss regression scenarios.

The test harnesses are development-only and excluded from the production bundle.
See `art-direction.md` for the built-in image-generation prompts and asset paths.
