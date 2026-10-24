import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import type { PlayerIndex, PoseId } from '../contracts';
import { onFrame, now, tween, wait, ease } from '../core/clock';
import { approach, lerpColor } from '../core/math';
import { textures } from '../fx/textures';
import { fonts, makeText, palette, PLAYER_COLORS } from '../theme';

type Stance = PoseId | 'idle';

/** [back arm, front arm] rotations. 0 = hanging down, PI = straight up. */
const ARM_ANGLES: Record<Stance, [number, number]> = {
  idle: [0.25, -0.35],
  'arms-up': [Math.PI - 0.3, Math.PI + 0.3],
  't-pose': [Math.PI / 2, -Math.PI / 2],
  crouch: [-1.1, -1.4],
};

const SHOULDER_Y = -70;
const ARM_LENGTH = 36;

/** One of the two player characters, drawn procedurally and posed live from input. */
export class Hero extends Container {
  readonly color: number;
  private readonly body = new Container();
  private readonly armBack = new Graphics();
  private readonly armFront = new Graphics();
  private readonly staff = new Container();
  private readonly orb: Sprite;
  private readonly ice = new Graphics();
  private readonly meterBar = new Graphics();
  private readonly mark = new Container();
  private readonly nameplate: Text;
  private stance: Stance = 'idle';
  private angles: [number, number] = [...ARM_ANGLES.idle];
  private castTimer = 0;
  private frozen = false;
  private readonly phase: number;

  constructor(readonly index: PlayerIndex) {
    super();
    this.color = PLAYER_COLORS[index];
    this.phase = index * 1.7;

    const halo = new Sprite(textures.glow);
    halo.anchor.set(0.5);
    halo.tint = this.color;
    halo.blendMode = 'add';
    halo.scale.set(1.3, 0.35);
    halo.alpha = 0.5;
    this.addChild(new Graphics().ellipse(0, 2, 36, 9).fill({ color: 0x000000, alpha: 0.4 }), halo);

    this.drawArm(this.armBack, lerpColor(this.color, 0x000000, 0.45));
    this.drawArm(this.armFront, lerpColor(this.color, 0x000000, 0.2));
    this.armBack.position.set(-12, SHOULDER_Y);
    this.armFront.position.set(12, SHOULDER_Y);

    this.orb = new Sprite(textures.glow);
    this.orb.anchor.set(0.5);
    this.orb.tint = this.color;
    this.orb.blendMode = 'add';
    this.orb.scale.set(0.4);
    this.orb.position.set(0, -64);
    this.staff.addChild(
      new Graphics().roundRect(-3, -60, 6, 92, 3).fill(0x6b4423).circle(0, -64, 8).fill(0xffffff),
      this.orb,
    );

    this.body.addChild(this.armBack, this.drawTorso(), this.drawHead(), this.armFront, this.staff);
    this.addChild(this.body);

    this.ice.roundRect(-38, -150, 76, 154, 14).fill({ color: palette.frost, alpha: 0.35 }).stroke({ width: 3, color: 0xe6fbff, alpha: 0.8 });
    this.ice.poly([-30, -140, -10, -150, -24, -100]).fill({ color: 0xffffff, alpha: 0.35 });
    this.ice.alpha = 0;
    this.addChild(this.ice);

    this.meterBar.position.set(0, -168);
    this.mark.position.set(0, -190);
    this.addChild(this.meterBar, this.mark);

    this.nameplate = makeText('', { fontFamily: fonts.heading, fontWeight: '700', fontSize: 20, fill: this.color, stroke: { color: 0x0b0a1a, width: 5 } });
    this.nameplate.position.set(0, 28);
    this.addChild(this.nameplate);

    onFrame((dt) => this.update(dt));
  }

  setName(name: string): void {
    this.nameplate.text = name;
  }

  setPose(pose: PoseId | null): void {
    this.stance = pose ?? 'idle';
  }

  setFrozen(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    void tween(this.ice, { alpha: on ? 1 : 0 }, 0.3);
    this.body.tint = on ? 0xb8ecff : 0xffffff;
  }

  /** Raise the staff; returns the orb position in the parent's space for spawning a bolt. */
  cast(): { x: number; y: number } {
    this.castTimer = 0.3;
    this.orb.scale.set(0.9);
    void tween(this.orb.scale, { x: 0.4, y: 0.4 }, 0.4);
    return this.staffTip();
  }

  staffTip(): { x: number; y: number } {
    return this.parent ? this.parent.toLocal(this.orb.getGlobalPosition()) : { x: this.x, y: this.y - 120 };
  }

  async hurt(): Promise<void> {
    const homeX = this.x;
    this.body.tint = palette.danger;
    this.x = homeX - 18;
    void tween(this, { x: homeX }, 0.4, ease.outBack);
    for (let i = 0; i < 3; i++) {
      this.body.alpha = 0.35;
      await wait(0.07);
      this.body.alpha = 1;
      await wait(0.07);
    }
    this.body.tint = this.frozen ? 0xb8ecff : 0xffffff;
  }

  async celebrate(): Promise<void> {
    const y = this.y;
    await tween(this, { y: y - 34 }, 0.18, ease.outCubic);
    await tween(this, { y }, 0.22, ease.inCubic);
  }

  /** Small progress bar above the head (0..1), or null to hide. */
  setMeter(value: number | null, color = this.color): void {
    this.meterBar.clear();
    if (value === null) return;
    this.meterBar.roundRect(-34, -6, 68, 12, 6).fill({ color: 0x0b0a1a, alpha: 0.75 }).stroke({ width: 2, color: palette.gold });
    if (value > 0) this.meterBar.roundRect(-32, -4, 64 * Math.min(1, value), 8, 4).fill(color);
  }

  /** Check / cross / nothing above the head. */
  setMark(kind: 'ok' | 'fail' | null): void {
    this.mark.removeChildren().forEach((c) => c.destroy());
    if (!kind) return;
    const g = new Graphics().circle(0, 0, 18).fill(kind === 'ok' ? 0x2f9e5b : 0xb3263b).stroke({ width: 3, color: palette.gold });
    if (kind === 'ok') g.moveTo(-8, 0).lineTo(-2, 7).lineTo(9, -7).stroke({ width: 4, color: 0xffffff, cap: 'round', join: 'round' });
    else g.moveTo(-7, -7).lineTo(7, 7).moveTo(7, -7).lineTo(-7, 7).stroke({ width: 4, color: 0xffffff, cap: 'round' });
    this.mark.addChild(g);
    this.mark.scale.set(0.3);
    void tween(this.mark.scale, { x: 1, y: 1 }, 0.35, ease.outBack);
  }

  private update(dt: number): void {
    const t = now();
    const target = ARM_ANGLES[this.stance];
    const frontTarget = this.castTimer > 0 ? -2.3 : target[1];
    this.castTimer = Math.max(0, this.castTimer - dt);
    const rate = this.frozen ? 0 : 14;
    this.angles[0] = approach(this.angles[0], target[0], rate, dt);
    this.angles[1] = approach(this.angles[1], frontTarget, rate, dt);
    this.armBack.rotation = this.angles[0];
    this.armFront.rotation = this.angles[1];

    const crouch = this.stance === 'crouch' ? 0.72 : 1;
    this.body.scale.y = approach(this.body.scale.y, crouch, rate, dt);
    this.body.y = this.frozen ? 0 : Math.sin(t * 2.4 + this.phase) * 2;

    // The staff follows the front hand but stays mostly upright.
    const a = this.angles[1];
    this.staff.position.set(this.armFront.x - Math.sin(a) * ARM_LENGTH, SHOULDER_Y + Math.cos(a) * ARM_LENGTH);
    this.staff.rotation = Math.sin(a) * -0.35;
    this.orb.alpha = 0.7 + 0.3 * Math.sin(t * 5 + this.phase);
  }

  private drawArm(g: Graphics, color: number): void {
    g.roundRect(-5, -2, 10, ARM_LENGTH + 2, 5).fill(color).circle(0, ARM_LENGTH, 6).fill(0xf2c9a0);
  }

  private drawTorso(): Graphics {
    const robe = lerpColor(this.color, 0x1a1030, 0.35);
    const g = new Graphics();
    g.poly([-30, 0, 30, 0, 17, -78, -17, -78]).fill(robe);
    g.poly([-30, 0, 30, 0, 28, -8, -28, -8]).fill(palette.gold);
    g.poly([-4, -78, 4, -78, 8, 0, -8, 0]).fill({ color: 0xffffff, alpha: 0.12 });
    g.rect(-19, -48, 38, 6).fill(palette.goldDeep);
    return g;
  }

  private drawHead(): Graphics {
    const g = new Graphics();
    if (this.index === 1) g.poly([-18, -100, 18, -100, 22, -66, -22, -66]).fill(0x7a3b1c); // long hair behind
    g.circle(0, -96, 17).fill(0xf2c9a0);
    g.circle(7, -98, 2.4).fill(0x2b1a0e).circle(-1, -98, 2.4).fill(0x2b1a0e);
    g.ellipse(10, -91, 3, 1.5).fill({ color: 0xd9776a, alpha: 0.6 });
    if (this.index === 0) {
      // Pointed wizard hat with a star.
      const hat = lerpColor(this.color, 0x10183a, 0.5);
      g.ellipse(0, -108, 30, 7).fill(hat);
      g.poly([-18, -110, 18, -110, 6, -150, -14, -168]).fill(hat);
      g.rect(-18, -114, 36, 5).fill(palette.gold);
      g.star(-2, -134, 5, 6, 2.5).fill(palette.star);
    } else {
      // Fringe and a jeweled circlet.
      g.arc(0, -98, 18, Math.PI, Math.PI * 2).fill(0x8a4520);
      g.rect(-18, -108, 36, 4).fill(palette.gold);
      g.poly([-6, -108, 0, -120, 6, -108]).fill(palette.gold);
      g.circle(0, -112, 3).fill(this.color);
    }
    return g;
  }
}
