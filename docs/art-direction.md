# RealityRift art direction


## Exploration and movement expansion

The six rendered exploration props are saved beside the other art as
`prop-chest.webp`, `prop-shrine.webp`, `prop-portal.webp`, `prop-quest.webp`,
`prop-pillar.webp`, and `prop-lore.webp`. They were generated as one transparent
sheet with the built-in image tool, then mechanically split into six cutouts.

### Exact prop prompt

Use case: stylized-concept. Asset type: transparent fantasy adventure game prop sheet. Exactly SIX isolated realistic 3D rendered game objects in a strict uniform 3-column by 2-row grid. Entire background genuinely transparent. NO ground plane, cast shadows, text, grid lines, lettering, decorative borders or overlap. Each object centered in its cell with generous clear gutters. Slightly elevated three-quarter camera consistent across all six, soft warm daylight from upper left. Detailed mossy stone, weathered bronze and wood, emerald magical palette to match an enchanted medieval forest. Row one left: CLOSED ornate ancient wooden treasure chest with brass bands and green patina, broad low proportions. Row one middle: circular carved pale gray stone healing fountain basin on a short weathered pedestal, glowing cyan water. Row one right: tall ruined mossy stone portal arch with two thick pillars and softly glowing mint-green magical mist inside the arch. Row two left: short weathered stone pedestal supporting a floating faceted GOLDEN crystal, original magical quest waystone. Row two middle: small irregular broken standing stone, gray mossy stone, old abstract carvings with subtle green glow, short broad monolith obstacle. Row two right: full-body ethereal kind woodland spirit woman with flowing translucent mint robe, long pale hair, warm calm expression, hands gently open, realistic proportions and face. All six items fully visible, separately isolated, no parts crossing cell boundaries. High quality realistic physically based material rendering.

Generated using the built-in image tool. The exploration grounds have a continuous walkable floor; the original cinematic backdrops remain in encounters. The transparent hero atlases each contain 30 aligned frames: five each for walking, walking away, running, rolling, casting and hit reactions. Idle breathing, celebration, light and spell trails are animated in the engine.

Final assets are saved under `C:/Users/Risha/Documents/Codex/RealityRift/frontend/public/art/`:

- `forest-field.webp`
- `castle-field.webp`
- `cave-field.webp`
- `ranger-motion.webp`
- `mage-motion.webp`

The atlas cells are 256 × 256, with a ground baseline at y=240. `frontend/scripts/prepare-motion.py` mechanically slices and aligns the generated sheets without replacing the source images. In-game texture frames share two atlas textures, so 60 frames do not require 60 downloads.

### Exact exploration prompts

**forest-field**

Use case: stylized-concept. Asset type: original fantasy action RPG playable area background, landscape 16:9. Realistically rendered 3D environment, lush cinematic adventure atmosphere. Camera elevated 30 degrees looking down into a large broad WALKABLE CLEARING. CRITICAL: entire lower 55 percent of the image is continuous solid mostly level open ground, all the way from the left edge to the right edge. No chasms, water, large obstacles, bridges, stairs or cliffs on the lower 55 percent. Small surface texture and paving allowed. Characters and interactable props will be added by the game later. Rich atmospheric landscape and architecture frame the TOP 45 percent and far outside edges. Broad ground space with clear depth, contact lighting, physically believable detailed materials. No people, creatures, chests, shrines, foreground pillars, UI, lettering, labels, watermark. An ancient emerald forest clearing, broad moss-flecked stone courtyard floor across the entire bottom half, soft grass borders, huge trees arching overhead, ruins and a small radiant mint magical arch at the far background, golden afternoon rays and distant mountain foliage. Earthy warm gray ground and jewel green forest, bright readable gameplay lighting.

**castle-field**

Use case: stylized-concept. Asset type: original fantasy action RPG playable area background, landscape 16:9. Realistically rendered 3D environment, lush cinematic adventure atmosphere. Camera elevated 30 degrees looking down into a large broad WALKABLE CLEARING. CRITICAL: entire lower 55 percent of the image is continuous solid mostly level open ground, all the way from the left edge to the right edge. No chasms, water, large obstacles, bridges, stairs or cliffs on the lower 55 percent. Small surface texture and paving allowed. Characters and interactable props will be added by the game later. Rich atmospheric landscape and architecture frame the TOP 45 percent and far outside edges. Broad ground space with clear depth, contact lighting, physically believable detailed materials. No people, creatures, chests, shrines, foreground pillars, UI, lettering, labels, watermark. A majestic abandoned castle courtyard at golden dusk. Broad flat pale sandstone flagstone plaza across the entire bottom half, climbing rose vines confined to edges, delicate pointed arches and towers at the back of the courtyard, magical blue lanterns under archways, distant pastel sunset sky. Elegant ivory stone and muted gold, green vines, spacious playable floor.

**cave-field**

Use case: stylized-concept. Asset type: original fantasy action RPG playable area background, landscape 16:9. Realistically rendered 3D environment, lush cinematic adventure atmosphere. Camera elevated 30 degrees looking down into a large broad WALKABLE CLEARING. CRITICAL: entire lower 55 percent of the image is continuous solid mostly level open ground, all the way from the left edge to the right edge. No chasms, water, large obstacles, bridges, stairs or cliffs on the lower 55 percent. Small surface texture and paving allowed. Characters and interactable props will be added by the game later. Rich atmospheric landscape and architecture frame the TOP 45 percent and far outside edges. Broad ground space with clear depth, contact lighting, physically believable detailed materials. No people, creatures, chests, shrines, foreground pillars, UI, lettering, labels, watermark. A vast enchanted crystal cavern. Broad flat natural slate stone floor across the entire bottom half, with fine faint luminous blue mineral seams. Tall blue and turquoise crystal formations and cavern arches only in the top half and far outer edges. Distant glowing gateway, overhead shafts of cold light, scattered glimmering dust. Floor must be solid dark blue stone with no water or holes, clear readable lighting.

### Exact movement prompt

Reference inputs: the corresponding local ranger-idle.webp and mage-idle.webp. One generated sheet per hero, with transparent background.

Use case: stylized-concept. Create a production 2D game animation sprite sheet of the EXACT realistic 3D fantasy hero in the attached reference. Preserve face, hairstyle, costume colors, armor, cloak, boots and proportions. A clean uniform grid of exactly FIVE columns and SIX rows = THIRTY full-body animation frames, all isolated on genuinely transparent background. Square high resolution canvas. Every cell identical size with generous transparent gutters. NO text, labels, grid lines, shadows, decorations or extra figures. Each frame centered in its own cell with feet on a consistent baseline. Cinematic realistic PBR 3D character rendering, same soft lighting across all frames. Five columns are five consecutive temporal keyframes per action, left to right. Row 1: five-step looping WALK cycle viewed three-quarter front, moving toward screen right, alternating visibly bent and extended legs and swinging arms and cloak. Row 2: five-step looping WALK cycle viewed three-quarter BACK moving away to upper right; actual rear of costume visible. Row 3: five-step looping RUN cycle viewed three-quarter front moving right, deep forward lean, long strides and flying cloak. Row 4: five consecutive DODGE ROLL frames toward right: crouch, forward tuck, horizontal roll, landing crouch, rising. Row 5: five CAST SPELL frames: prepare, raise right hand, wind up, powerful arm thrust right, recovery; no external magic effect. Row 6: five HIT REACTION frames: impact, recoil, stagger, brace, recovery standing. All thirty frames must be distinct anatomically plausible poses of the SAME character, no duplicates. Keep the entire figure within each cell. This is an animation asset, not a poster.


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
