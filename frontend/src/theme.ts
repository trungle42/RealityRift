import { Text, type TextStyleOptions } from 'pixi.js';

/** Everything is laid out in this virtual resolution and letterboxed to the window. */
export const VIEW = { width: 1280, height: 720 } as const;
export const GROUND_Y = 550;
export const HERO_X = [245, 425] as const;
export const FOE_X = 1010;

export const palette = {
  night: 0x081713,
  ink: 0x24352e,
  parchment: 0xf0ecd9,
  parchmentDark: 0xd8bd8a,
  gold: 0xddc48e,
  goldDeep: 0x9d8050,
  frost: 0x9fe6ff,
  shadow: 0x2a0f3d,
  danger: 0xff5a5a,
  heart: 0xe87878,
  star: 0xe2c481,
  fairy: 0xb9ffd2,
} as const;

export const PLAYER_COLORS = [0x8ee3c4, 0xedc18a] as const;

export const fonts = {
  display: '"Cinzel", Georgia, serif',
  heading: '"Cinzel", Georgia, serif',
  body: '"IM Fell English", Georgia, serif',
} as const;

export function makeText(text: string, style: TextStyleOptions, anchor = 0.5): Text {
  const t = new Text({ text, style: { fontFamily: fonts.body, fill: palette.parchment, ...style } });
  t.anchor.set(anchor);
  return t;
}

/** Gold title lettering with a dark outline, used for banners and headings. */
export function goldText(text: string, size: number, family: string = fonts.display): Text {
  return makeText(text, {
    fontFamily: family,
    fontSize: size,
    fill: palette.gold,
    stroke: { color: 0x0b1c18, width: 2 },
    dropShadow: { color: 0x000000, alpha: 0.6, blur: 8, distance: 3, angle: Math.PI / 2 },
    letterSpacing: size / 20,
    align: 'center',
  });
}
