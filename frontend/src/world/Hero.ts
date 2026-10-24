import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import type { PlayerIndex, PoseId } from '../contracts';
import { onFrame, now, tween, wait, ease } from '../core/clock';
import { textures } from '../fx/textures';
import { fonts, makeText, palette, PLAYER_COLORS } from '../theme';
import { art } from './art';
import { HeroAnimation, type Locomotion } from './animation';

type Stance = PoseId | 'idle';
const HEIGHT: Record<Stance, number> = { idle: 196, 'arms-up': 238, 't-pose': 196, crouch: 126 };

/** Dimensional rendered heroes with an anatomically correct frame for each pose. */
export class Hero extends Container {
  readonly color: number;
  private readonly body = new Sprite();
  private readonly echo = new Sprite();
  private readonly orb = new Sprite(textures.glow);
  private readonly ice = new Graphics();
  private readonly meterBar = new Graphics();
  private readonly mark = new Graphics();
  private readonly nameplate: Text;
  private stance: Stance = 'idle';
  private frozen = false;
  private castTimer = 0;
  private transition = 1;
  private readonly animation = new HeroAnimation();
  private readonly stopUpdates: () => void;

  constructor(readonly index: PlayerIndex) {
    super();
    this.color = PLAYER_COLORS[index];
    const shadow = new Sprite(textures.glow);
    shadow.anchor.set(0.5);
    shadow.tint = 0x000000;
    shadow.scale.set(1.0, 0.14);
    shadow.alpha = 0.7;
    shadow.y = 1;
    const rune = new Graphics().ellipse(0, 0, 42, 8).stroke({ color: this.color, width: 1, alpha: 0.4 });
    this.body.anchor.set(0.5, 1);
    this.echo.anchor.set(0.5, 1);
    this.echo.alpha = 0;
    this.setBody('idle');
    this.orb.anchor.set(0.5);
    this.orb.position.set(36, -112);
    this.orb.tint = this.color;
    this.orb.blendMode = 'add';
    this.orb.scale.set(0.3);
    this.orb.alpha = 0.45;
    this.addChild(shadow, rune, this.echo, this.body, this.orb);
    this.ice.poly([-45, 0, -54, -150, -26, -210, 30, -205, 52, -140, 42, 0])
      .fill({ color: palette.frost, alpha: 0.2 }).stroke({ width: 1, color: 0xe4ffff, alpha: 0.8 });
    this.ice.moveTo(-26, -210).lineTo(12, -150).lineTo(-20, -80).lineTo(30, 0).stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
    this.ice.alpha = 0;
    this.meterBar.y = -258;
    this.mark.y = -284;
    this.nameplate = makeText('', { fontFamily: fonts.heading, fontSize: 14, letterSpacing: 2, fill: this.color, stroke: { color: 0x07120f, width: 4 } });
    this.nameplate.y = 24;
    this.addChild(this.ice, this.meterBar, this.mark, this.nameplate);
    this.stopUpdates = onFrame((dt) => this.update(dt));
  }
  override destroy(): void { this.stopUpdates(); super.destroy({ children: true }); }
  setName(name: string): void { this.nameplate.text = name; this.nameplate.scale.set(Math.min(1, 150 / this.nameplate.width)); }
  get animationState() { return this.animation.current; }
  setWalking(on: boolean, direction = 0): void { this.animation.move(on ? 'walk' : 'idle', direction); }
  setMovement(mode: Locomotion, dx: number, dy: number): void { this.animation.move(mode, dx, dy); }
  dodge(): void { this.animation.trigger('roll'); }
  recoil(): void { this.animation.trigger('hit'); }
  resetAnimation(): void { this.animation.reset(); }
  setPose(pose: PoseId | null): void {
    const next = pose ?? 'idle';
    if (next === this.stance || this.frozen) return;
    this.echo.texture = this.body.texture;
    this.echo.scale.copyFrom(this.body.scale);
    this.echo.alpha = 1;
    this.stance = next;
    this.setBody(next);
    this.transition = 0;
  }
  private setBody(stance: Stance): void {
    this.body.texture = art(`${this.index === 0 ? 'ranger' : 'mage'}-${stance}`);
    this.body.anchor.set(0.5, 1);
    this.body.scale.set(HEIGHT[stance] / this.body.texture.height);
  }
  setFrozen(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    void tween(this.ice, { alpha: on ? 1 : 0 }, 0.3);
    this.body.tint = on ? 0x9edce9 : 0xffffff;
  }
  cast(): { x: number; y: number } { this.castTimer = 0.42; this.animation.trigger('cast'); return this.staffTip(); }
  staffTip(): { x: number; y: number } {
    return this.parent ? this.parent.toLocal(this.orb.getGlobalPosition()) : { x: this.x + 36, y: this.y - 112 };
  }
  async hurt(): Promise<void> {
    this.recoil();
    const homeX = this.x;
    this.body.tint = 0xff9d8f;
    this.x -= 14;
    void tween(this, { x: homeX }, 0.35, ease.outCubic);
    await wait(0.18);
    if (!this.destroyed) this.body.tint = this.frozen ? 0x9edce9 : 0xffffff;
  }
  async celebrate(): Promise<void> {
    const y = this.y;
    await tween(this, { y: y - 16 }, 0.2, ease.outCubic);
    await tween(this, { y }, 0.25, ease.inCubic);
  }
  setMeter(value: number | null, color = this.color): void {
    this.meterBar.clear();
    if (value === null) return;
    this.meterBar.roundRect(-34, -3, 68, 6, 3).fill({ color: 0x07120f, alpha: 0.9 });
    if (value > 0) this.meterBar.roundRect(-33, -2, 66 * Math.min(1, value), 4, 2).fill(color);
  }
  setMark(kind: 'ok' | 'fail' | null): void {
    const g = this.mark.clear();
    if (!kind) return;
    g.circle(0, 0, 13).fill({ color: 0x0c201a, alpha: 0.9 }).stroke({ color: kind === 'ok' ? this.color : palette.danger, width: 1 });
    if (kind === 'ok') g.moveTo(-6, 0).lineTo(-1, 5).lineTo(7, -5).stroke({ width: 2, color: this.color });
    else g.moveTo(-5, -5).lineTo(5, 5).moveTo(5, -5).lineTo(-5, 5).stroke({ width: 2, color: palette.danger });
  }
  private update(dt: number): void {
    this.transition = Math.min(1, this.transition + dt * 9);
    this.body.alpha = this.transition;
    this.echo.alpha = 1 - this.transition;
    this.castTimer = Math.max(0, this.castTimer - dt);
    const breathing = this.frozen ? 0 : Math.sin(now() * 1.6 + this.index) * 0.003;
    const motion = this.animation.advance(dt, this.frozen);
    if (motion.clip !== 'idle' && !this.frozen) {
      this.body.texture = art(`${this.index === 0 ? 'ranger' : 'mage'}-${motion.clip}-${motion.frame}`);
      this.body.anchor.set(0.5, 240 / 256);
      this.body.scale.set(motion.facing, 1);
      this.body.alpha = 1; this.echo.alpha = 0;
    } else {
      this.setBody(this.stance);
      const scale = HEIGHT[this.stance] / this.body.texture.height;
      this.body.scale.set(scale * motion.facing, scale * (1 + breathing));
    }
    this.body.y = 0; this.body.rotation = 0;
    this.orb.x = 36 * motion.facing;
    this.orb.visible = motion.clip !== 'roll' && motion.clip !== 'backwalk';
    this.orb.y = this.stance === 'crouch' ? -70 : this.stance === 'arms-up' ? -224 : -112;
    this.orb.scale.set(this.castTimer > 0 ? 0.75 : 0.19 + Math.sin(now() * 2) * 0.025);
    this.orb.alpha = this.castTimer > 0 ? 0.95 : 0.45;
  }
}
