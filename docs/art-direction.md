# RealityRift art direction

Original assets generated with the built-in image-generation tool on October 24,
2026, then stored as optimized WebP files in `frontend/public/art`. No runtime
generation calls or secret keys are required. The supplied adventurer image was
used as visual inspiration for realistic proportions, ancient ruins, emerald
foliage and warm volumetric light; it was not copied into the game.

## Asset manifest

| Files under `frontend/public/art/` | Purpose |
| --- | --- |
| `forest.webp`, `castle.webp`, `cave.webp` | Perspective environment paintings |
| `ranger-idle.webp`, `ranger-arms-up.webp`, `ranger-t-pose.webp`, `ranger-crouch.webp` | Woodland guardian poses |
| `mage-idle.webp`, `mage-arms-up.webp`, `mage-t-pose.webp`, `mage-crouch.webp` | Dawn spellweaver poses |
| `witch.webp`, `dragon.webp` | Frost queen and shadow wyrm |
| `wisp.webp`, `imp.webp` | Enemy creatures |

Character pose sheets were mechanically extracted into separate frames using
their transparent bounds; alpha was preserved. Sprite orientation, pose size,
contact shadows and lighting effects are composed by the game renderer.

## Prompt set

All prompts used the `stylized-concept` use case. Environment prompts requested
16:9 finished game backgrounds without characters, UI, logos, text or watermarks.
Character/creature prompts requested physically shaded, realistically proportioned
AAA-style 3D renders on true transparent backgrounds, not flat cartoon art.

**Forest:** Cinematic hand-painted fantasy forest with the atmosphere of Zelda
Breath of the Wild and storybook concept art. Ancient moss-covered arches,
luminous turquoise circular shrine in the distant center-right, towering trees,
sunbeams from upper right, layered mist, glowing flowers, emerald/celadon foliage,
warm golden afternoon light. Eye-level wide clearing, quiet horizontal mossy
stone path across the lower quarter, darker left third for menu typography.

**Castle:** Fantasy castle courtyard at twilight. Vast ruined ivory towers,
soaring buttresses, circular turquoise magical seal above a distant arch,
climbing ivy, amber lanterns, lavender mist and pale golden sunset. Flat
cobblestone terrace for heroes, carved foreground wall and ivy, framing arches.

**Cave:** Ancient crystal cavern with giant stone columns and a carved doorway,
turquoise crystals and bioluminescent plants, underground mirror lake, golden
dust, lavender mist, shafts of moonlight, deep teal and blue-black palette.
Horizontal stone walkway, foreground rock and hanging vines, dark left third.

**Ranger pose sheet:** Four full-body renders of the same adult elven male ranger,
detailed leather armor, emerald hooded cloak, weathered gold trim, realistic
face, boots and belt, facing three-quarter right. Neutral, arms overhead,
horizontal T-pose, and deep crouch in a 2×2 atlas. No handheld weapon; consistent
proportions, transparent padding, warm upper-right light and turquoise rim light.

**Spellweaver pose sheet:** The same four poses for an adult female human
spellblade, ivory and deep burgundy cloak, practical bronze/leather armor,
russet braid, gold circlet, boots, realistic face and dimensional materials.
Three-quarter right; no handheld weapon; clear padding and transparent background.

**Frost queen:** Adult frost sorceress with midnight teal and silver armor-robes,
white hair, branching ice crown, embroidered floating cloak, pale realistic face,
cyan eyes and crystal staff. Full-body dimensional rendering, realistic silk,
carved metal and translucent ice, cyan rim light and warm frontal light.

**Dragon:** Full-body shadow dragon with four muscular legs, obsidian/indigo
scales, raised bat wings, ivory horns, curling tail, violet eyes and purple
throat. Facing left, grounded stance, believable anatomy and wing membranes,
turquoise rim lights, all parts in frame on transparent background.

**Enemy atlas:** Two full-body creatures with a clear gap. Left: floating shadow
wisp with ragged charcoal cloak, spectral wooden mask, violet eyes and smoky
tendrils. Right: hunched thorn imp with twisted roots, mossy bark, clawed hands,
amber eyes, twig horns and bramble spines. Three-quarter left, dimensional
materials and lighting, transparent background.
