# Storybound visual direction

## Reference and intent

Rishaan's `forest-field.webp`, ranger, mage, and creature artwork remain the visual reference. The 3D edition translates that setting into a traversable world: emerald cloth, aged bronze, moss-covered carved limestone, warm afternoon sunlight, and restrained mint magic. The forest sanctuary is the first area receiving the detailed asset pass. Castle and cave are playable supporting areas with simpler assets.

## World composition

The path connects a settled village, ancient waystone, ruined spell sanctuary, spirit tree, and crossroads. Ruins share one masonry kit because they belonged to the same sanctuary. Treasure sits beside old structures; healing springs occupy carved basins; starlight gathers around magical places. Vegetation frames these landmarks and leaves their approaches readable. Avoid arbitrary objects and unrelated styles.

## Character and material language

The ranger has emerald cloth, leather, bronze clasps, and a sword. The companion has a warm dawn-colored cloak and a moon-glass staff. Characters use an exported skeleton and named animation clips. World models use the same worn stone and metal treatments. Large objects must have collision that agrees with their silhouette.

## Interface

- Keep the world as the main visual surface. Health and stamina sit at the upper left; a compass at the top; the map at the upper right; actions at the bottom.
- Gold identifies story objectives and rewards. Mint identifies old magic and healing. Coral identifies damage and attack warnings. Distinguish these states with text and shape too.
- Use Cinzel for the title, IM Fell English for story headings and dialogue, and system sans for controls and status. UI body text uses a readable size and strong contrast.
- Use consistent keyboard badges, visible focus, named buttons, and contextual interaction prompts. Required story choices cannot be accidentally dismissed by journal shortcuts.
- The journal pauses play and contains detailed controls, the world map, and relics. Story text uses DOM text nodes so provider text cannot become markup.
- UI spacing follows an 8 px rhythm with larger 24–36 px edge margins. Narrow layouts reduce secondary detail before covering the player.
- Interface transitions are short. Honor reduced motion; decorative camera motion is disabled in that mode.

## Honest scope

This is an original browser adventure and a first 3D asset pass, not a recreation of the production scale or final art quality of Zelda or Genshin Impact. Keep the established 2.5D edition available while the new asset set develops.
