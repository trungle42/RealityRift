import * as T from 'three';

export function material(color: T.ColorRepresentation, emissive?: T.ColorRepresentation): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({ color, roughness: 0.85, emissive: emissive ?? 0x000000, emissiveIntensity: emissive ? 0.65 : 0 });
}

export function mesh(geometry: T.BufferGeometry, mat: T.Material, parent: T.Object3D, x = 0, y = 0, z = 0): T.Mesh {
  const item = new T.Mesh(geometry, mat);
  item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true; parent.add(item);
  return item;
}

/**
 * Active part of each stock one-shot clip, as [start, contact, end] seconds. The source clips are 2-2.5 s with a
 * long idle lead-in and a return to guard; playing all of that inside a 0.4 s swing ran them about 6x too fast.
 * Times come from tracking the blade: contact is where the cut crosses dead ahead, the chop's edge drops through,
 * or the thrust reaches full extension.
 */
const ONE_SHOTS: Record<string, [number, number, number]> = {
  sword_slash_horizontal: [0.45, 0.85, 1.4],
  sword_slash_overhead: [1.0, 1.38, 1.75],
  sword_thrust: [0.85, 1.4, 1.75],
  stagger_back: [0, 0.3, 0.95],
  punch_right: [1.0, 1.5, 1.95],
  hit_reaction: [0.8, 1.15, 1.8],
  death_fall: [0.1, 0.95, 1.6],
};
/** Seconds each reaction takes in play, and when its key moment (the flinch, hitting the ground) lands. */
const REACTIONS: Record<string, [number, number]> = { stagger_back: [0.45, 0.15], death: [1.1, 0.75] };

/** One gait cycle (two steps) of a looping locomotion clip: how far it travels and where its left-foot pass starts. */
interface Gait { speed: number; cycle: number; offset: number }
const gaits = new WeakMap<T.AnimationClip, Gait>();
/** Above this multiple of a clip's natural cadence the legs would look frantic, so a sprint lengthens its stride instead. */
const MAX_CADENCE = 2.1;

/** Original storybook adventurers, built as articulated meshes rather than billboards. */
export class Actor {
  readonly root = new T.Group();
  readonly body = new T.Group();
  readonly leftArm = new T.Group();
  readonly rightArm = new T.Group();
  readonly leftLeg = new T.Group();
  readonly rightLeg = new T.Group();
  readonly cloak: T.Mesh;
  readonly blade: T.Group;
  heading = Math.PI;
  moving = 0;
  attack = 0;
  hurt = 0;
  pose = '';
  /** Which swing clip plays while `attack` > 0, and how long that swing lasts. */
  attackClip = 'strike';
  attackLength = 0.4;
  /** Seconds into the swing when the blade connects; the clip's contact frame is timed to land here. */
  attackContact = 0.15;
  attackSerial = 0;
  /** Foes are near: hold the sword (or fists) in a ready stance instead of the relaxed idle. */
  guard = false;
  /** Fall and stay down. */
  dead = false;
  /** Seconds of hit-reaction animation remaining. */
  stagger = 0;
  /** Roll progress 0..1 while rolling, -1 otherwise: the body tucks and tumbles one full turn forward. */
  roll = -1;
  readonly color: number;
  private model?: T.Object3D;
  private modelBaseY = 0;
  private modelPivot?: T.Group;
  private modelPivotBaseY = 0;
  private mixer?: T.AnimationMixer;
  private readonly actions = new Map<string, T.AnimationAction>();
  private readonly gait = new Map<T.AnimationAction, Gait>();
  private readonly windows = new Map<string, [number, number, number]>();
  /** Blend weight each action is easing toward, and where it is now. */
  private readonly weights = new Map<T.AnimationAction, number>();
  private oneShot?: { action: T.AnimationAction; started: number; serial: number };
  private override?: T.AnimationAction;
  private phase = 0;
  private speed = 0;
  private ready = 0;
  private yawRate = 0;
  private clock = 0;
  private detailedRig = false;

  constructor(companion = false) {
    this.color = companion ? 0xdca967 : 0x4f9174;
    const cloth = material(this.color), trim = material(0xe6cc91), boots = material(0x493b32);
    const skin = material(0xf0c9a0), hair = material(companion ? 0x704731 : 0x594238);
    const shirt = material(companion ? 0xffe4b5 : 0xe7ead2);
    this.root.add(this.body);
    mesh(new T.CylinderGeometry(0.23, 0.32, 0.7, 8), cloth, this.body, 0, 1.03);
    mesh(new T.CylinderGeometry(0.34, 0.34, 0.1, 8), boots, this.body, 0, 0.85);
    mesh(new T.SphereGeometry(0.255, 12, 10), skin, this.body, 0, 1.69);
    const cap = mesh(new T.SphereGeometry(0.27, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, this.body, 0, 1.73);
    cap.rotation.y = 0.25;
    // The face looks along +Z; the camera can circle the actual character.
    const eyes = material(0x273d38);
    mesh(new T.SphereGeometry(0.025, 6, 6), eyes, this.body, -0.085, 1.7, 0.235);
    mesh(new T.SphereGeometry(0.025, 6, 6), eyes, this.body, 0.085, 1.7, 0.235);
    mesh(new T.ConeGeometry(0.09, 0.3, 5), skin, this.body, -0.29, 1.7).rotation.z = Math.PI * 0.68;
    mesh(new T.ConeGeometry(0.09, 0.3, 5), skin, this.body, 0.29, 1.7).rotation.z = -Math.PI * 0.68;
    mesh(new T.CylinderGeometry(0.29, 0.26, 0.12, 8), trim, this.body, 0, 1.43);
    this.cloak = mesh(new T.ConeGeometry(0.48, 1.06, 7, 1, true, 0, Math.PI), cloth, this.body, 0, 1, -0.14);
    this.cloak.rotation.y = Math.PI / 2; this.cloak.rotation.x = -0.12;
    this.leftArm.position.set(-0.33, 1.3, 0); this.rightArm.position.set(0.33, 1.3, 0);
    this.leftLeg.position.set(-0.14, 0.75, 0); this.rightLeg.position.set(0.14, 0.75, 0);
    this.body.add(this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);
    for (const arm of [this.leftArm, this.rightArm]) {
      mesh(new T.CapsuleGeometry(0.09, 0.3, 3, 6), shirt, arm, 0, -0.2);
      mesh(new T.SphereGeometry(0.09, 7, 6), skin, arm, 0, -0.43);
    }
    for (const leg of [this.leftLeg, this.rightLeg]) {
      mesh(new T.CapsuleGeometry(0.105, 0.35, 3, 6), boots, leg, 0, -0.27);
      mesh(new T.BoxGeometry(0.22, 0.17, 0.34), boots, leg, 0, -0.62, 0.045);
    }
    this.blade = new T.Group(); this.rightArm.add(this.blade); this.blade.position.set(0, -0.43, 0.05);
    if (companion) {
      mesh(new T.CylinderGeometry(0.035, 0.04, 1.65, 6), boots, this.blade, 0, 0.1);
      mesh(new T.IcosahedronGeometry(0.16, 0), material(0x8ff2e3, 0x76e8d1), this.blade, 0, 0.94);
      mesh(new T.TorusGeometry(0.23, 0.025, 5, 12), trim, this.blade, 0, 0.94);
    } else {
      mesh(new T.BoxGeometry(0.13, 0.8, 0.035), material(0xd9e8e4), this.blade, 0, -0.4);
      mesh(new T.ConeGeometry(0.08, 0.2, 4), material(0xf7f4da), this.blade, 0, -0.9).rotation.z = Math.PI;
      mesh(new T.BoxGeometry(0.42, 0.06, 0.09), trim, this.blade, 0, 0.02);
    }
    const bag = mesh(new T.BoxGeometry(0.3, 0.35, 0.2), boots, this.body, -0.31, 0.88, -0.13);
    bag.rotation.z = -0.1;
    this.root.traverse((o) => { if (o instanceof T.Mesh) o.castShadow = true; });
  }

  update(dt: number, time: number): void {
    this.attack = Math.max(0, this.attack - dt); this.hurt = Math.max(0, this.hurt - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    if (this.model && this.mixer) {
      this.animateModel(dt);
      this.model.visible = this.hurt <= 0 || Math.floor(this.hurt * 12) % 2 === 0;
      const turn = Math.atan2(Math.sin(this.heading - this.root.rotation.y), Math.cos(this.heading - this.root.rotation.y));
      // Turn quickly but not instantly; a sprint carves a slightly wider arc than a walk.
      const step = turn * Math.min(1, dt * (this.speed > 5 ? 13 : 17));
      this.root.rotation.y += step;
      this.yawRate += (step / Math.max(dt, 1e-3) - this.yawRate) * Math.min(1, dt * 10);
      // Bank into turns in proportion to how fast the body is actually swinging round at speed.
      const lean = T.MathUtils.clamp(-this.yawRate * this.speed * 0.012, -0.12, 0.12);
      this.model.rotation.z += (lean - this.model.rotation.z) * Math.min(1, dt * 8);
      // Rotate around the hips, not the feet, and lower the pivot slightly as the
      // tucked body passes through the middle of the forward roll. A hard sprint pitches the body forward a touch.
      const tumble = this.modelPivot ?? this.model;
      const pitch = this.roll >= 0 ? this.roll * Math.PI * 2 : T.MathUtils.clamp((this.speed - 5) * 0.025, 0, 0.09);
      tumble.rotation.x = this.roll >= 0 ? pitch : tumble.rotation.x + (pitch - tumble.rotation.x) * Math.min(1, dt * 6);
      const dip = this.roll >= 0 ? Math.sin(this.roll * Math.PI) * 0.18 : 0;
      if (this.modelPivot) this.modelPivot.position.y = this.modelPivotBaseY - dip;
      else this.model.position.y = this.modelBaseY - dip;
      return;
    }
    const stride = Math.sin(time * (this.moving > 6 ? 13 : 9)) * Math.min(1, this.moving / 3);
    this.leftLeg.rotation.x = stride * 0.75; this.rightLeg.rotation.x = -stride * 0.75;
    this.leftArm.rotation.x = -stride * 0.45; this.rightArm.rotation.x = stride * 0.45;
    this.leftArm.rotation.z = 0.12; this.rightArm.rotation.z = -0.12;
    if (this.attack > 0) {
      this.rightArm.rotation.x = -1.4 + Math.sin(this.attack / 0.4 * Math.PI) * 2.8;
      this.rightArm.rotation.z = -0.7;
    }
    if (this.pose === 'arms-up') { this.leftArm.rotation.z = 2.7; this.rightArm.rotation.z = -2.7; }
    if (this.pose === 't-pose') { this.leftArm.rotation.z = 1.5; this.rightArm.rotation.z = -1.5; }
    this.body.position.y = this.pose === 'crouch' ? -0.5 : Math.abs(stride) * 0.07 + Math.sin(time * 2.5) * 0.015;
    this.body.rotation.x = this.roll >= 0 ? this.roll * Math.PI * 2 : 0;
    this.cloak.rotation.x = -0.15 - Math.min(0.45, this.moving * 0.035) + Math.sin(time * 4) * 0.03;
    this.root.rotation.y += Math.atan2(Math.sin(this.heading - this.root.rotation.y), Math.cos(this.heading - this.root.rotation.y)) * Math.min(1, dt * 14);
    this.body.visible = this.hurt <= 0 || Math.floor(this.hurt * 12) % 2 === 0;
  }

  /**
   * Locomotion is a blend of idle, guard stance, walk and run whose stride is phase-locked to the measured speed, so
   * feet plant instead of sliding. Swings, hit reactions, rolls and held poses layer over it and ease in and out.
   */
  private animateModel(dt: number): void {
    const mixer = this.mixer!;
    this.clock += dt;
    this.speed += (this.moving - this.speed) * Math.min(1, dt * 10);
    this.ready += (Number(this.guard) - this.ready) * Math.min(1, dt * 3);
    const swing = this.attack > 0 ? (this.actions.has(this.attackClip) ? this.attackClip : 'strike') : '';
    const name = (this.dead && this.actions.has('death') ? 'death' : '') || (this.roll >= 0 && this.actions.has('roll') ? 'roll' : '') || (this.roll >= 0 && this.actions.has('crouch') ? 'crouch' : '')
      || this.pose || (this.stagger > 0 && this.actions.has('stagger_back') ? 'stagger_back' : swing);
    const override = name ? this.actions.get(name) : undefined;
    // Swings, reactions and rolls play once from the top; chaining the same swing (combo, flurry) restarts it.
    const oneShot = !!override && (name === swing || name === 'roll' || name in REACTIONS);
    if (override && oneShot && (override !== this.oneShot?.action || (name === swing && this.attackSerial !== this.oneShot.serial))) {
      this.oneShot = { action: override, started: this.clock, serial: this.attackSerial };
      // An interrupted move gets out of the way quickly instead of ghosting under the next one.
      if (this.override && this.override !== override) this.weights.set(this.override, Math.min(this.weights.get(this.override) ?? 0, 0.3));
    }
    this.override = override;
    if (override && this.oneShot?.action === override) override.time = this.oneShotTime(name, this.clock - this.oneShot.started);

    const walk = this.actions.get('walk'), run = this.actions.get('run');
    const walkGait = walk && this.gait.get(walk), runGait = run && this.gait.get(run);
    const scale = this.root.scale.x;
    const moving = T.MathUtils.smoothstep(this.speed, 0.15, 0.9);
    const running = walkGait && runGait ? T.MathUtils.smoothstep(this.speed, walkGait.speed * scale * 1.2, runGait.speed * scale * 0.95) : runGait ? 1 : 0;
    if (walkGait || runGait) {
      const a = walkGait ?? runGait!, b = runGait ?? walkGait!;
      const stride = T.MathUtils.lerp(a.speed * a.cycle, b.speed * b.cycle, running) * scale;
      const natural = T.MathUtils.lerp(1 / a.cycle, 1 / b.cycle, running);
      // Above the cap a sprint lengthens its stride (some slide) rather than cycling the legs absurdly fast.
      this.phase = (this.phase + Math.min(this.speed / stride, natural * MAX_CADENCE) * dt) % 1;
      for (const [action, g] of [[walk, walkGait], [run, runGait]] as const) if (action && g) action.time = (g.offset + this.phase * g.cycle) % action.getClip().duration;
    }

    const idle = this.actions.get('idle'), guard = this.actions.get('guard');
    const isBase = (action: T.AnimationAction) => this.gait.has(action) || action === idle || action === guard;
    for (const action of this.actions.values()) {
      if (isBase(action)) continue;
      const target = action === override ? 1 : 0, w = this.weights.get(action) ?? 0;
      this.weights.set(action, w + (target - w) * Math.min(1, dt * (target ? (oneShot ? 30 : 12) : name === 'crouch' || !name ? 10 : 16)));
    }
    let layered = 0;
    for (const [action, w] of this.weights) if (!isBase(action)) layered += w;
    // The base layer always totals 1 and overrides are scaled so they take exactly their share. Three blends any bone
    // whose weights total under 1 back toward the bind pose, so this keeps the legs in the stance while an arms-only
    // pose plays, instead of dragging them straight.
    const share = 1 / Math.max(1e-4, 1 - Math.min(0.9999, layered));
    const still = 1 - moving;
    if (idle) this.weights.set(idle, guard ? still * (1 - this.ready) : still);
    if (guard) this.weights.set(guard, idle ? still * this.ready : still);
    if (walk) this.weights.set(walk, moving * (run ? 1 - running : 1));
    if (run) this.weights.set(run, moving * (walk ? running : 1));
    for (const [action, w] of this.weights) {
      const effective = isBase(action) ? w : w * share;
      action.enabled = effective > 0.002; action.setEffectiveWeight(effective);
    }
    mixer.update(dt);
  }

  /** Clip time for a one-shot: time-warped so its contact frame lands on `attackContact`, its active part only. */
  private oneShotTime(name: string, elapsed: number): number {
    const action = this.actions.get(name)!, duration = action.getClip().duration;
    if (name === 'roll') return Math.max(0, this.roll) * duration;
    const [length, contact] = REACTIONS[name] ?? [Math.max(0.15, this.attackLength), this.attackContact];
    const window = this.windows.get(name);
    if (!window) return Math.min(duration, elapsed / length * duration);
    const [start, hit, end] = window, at = Math.min(contact, length * 0.85);
    return elapsed < at ? start + (hit - start) * (elapsed / at) : Math.min(end, hit + (end - hit) * (elapsed - at) / Math.max(0.05, length - at));
  }

  /** Measure one gait cycle of a looping clip by watching the feet pass each other. */
  private measureGait(original: T.AnimationClip, action: T.AnimationAction, speed: number): Gait {
    const cached = gaits.get(original); if (cached) return cached;
    const model = this.model!, left = model.getObjectByName('LeftFoot'), right = model.getObjectByName('RightFoot');
    const clip = action.getClip(), fallback: Gait = { speed: speed || (this.detailedRig ? 3.4 : 4.7), cycle: clip.duration, offset: 0 };
    if (!left || !right || !speed) return fallback;
    action.reset().play(); action.setEffectiveWeight(1);
    const steps = Math.max(24, Math.round(clip.duration * 60)), crossings: number[] = [], a = new T.Vector3(), b = new T.Vector3();
    let previous = 0;
    for (let i = 0; i <= steps; i++) {
      action.time = clip.duration * i / steps; this.mixer!.update(0); model.updateWorldMatrix(true, true);
      const gap = model.worldToLocal(left.getWorldPosition(a)).z - model.worldToLocal(right.getWorldPosition(b)).z;
      if (i && previous < 0 && gap >= 0) crossings.push(action.time);
      previous = gap;
    }
    action.stop();
    const gait = crossings.length ? { speed, cycle: clip.duration / crossings.length, offset: crossings[0] } : fallback;
    gaits.set(original, gait);
    return gait;
  }

  useModel(model: T.Object3D, clips: T.AnimationClip[], companion: boolean, additionalClips: T.AnimationClip[] = []): void {
    this.body.visible = false; this.model = model;
    this.detailedRig = !!model.getObjectByName('LeftArm');
    if (this.detailedRig) {
      const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
      const scale = 1.9 / size.y; model.scale.setScalar(scale); model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    }
    if (this.detailedRig) {
      model.updateWorldMatrix(true, true);
      const hips = model.getObjectByName('Hips');
      const pivotY = hips?.getWorldPosition(new T.Vector3()).y ?? 0.95;
      this.modelPivot = new T.Group(); this.modelPivot.position.y = pivotY;
      model.position.y -= pivotY;
      this.modelPivot.add(model); this.root.add(this.modelPivot);
      this.modelPivotBaseY = pivotY;
    } else {
      this.root.add(model); this.modelBaseY = model.position.y;
    }
    model.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      object.castShadow = true; object.receiveShadow = true;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      const converted = mats.map((mat: T.MeshStandardMaterial) => {
        const copy = mat.clone();
        if (companion && copy.name === 'ranger-emerald') { copy.map = null; copy.color.set(0xb29767); }
        return copy;
      });
      object.material = Array.isArray(object.material) ? converted : converted[0];
    });
    this.mixer = new T.AnimationMixer(model);
    const aliases: Record<string, string> = {
      walk_forward: 'walk', run_forward: 'run', sword_slash_horizontal: 'strike',
      sword_idle: 'guard', combat_idle: 'guard', hit_reaction: 'stagger_back', death_fall: 'death',
    };
    model.updateWorldMatrix(true, true);
    const rootScale = this.root.getWorldScale(new T.Vector3()).x;
    for (const original of [...clips, ...additionalClips]) {
      const clip = original.clone(); clip.name = aliases[clip.name] ?? clip.name;
      if (this.actions.has(clip.name)) continue;
      clip.tracks = clip.tracks.filter((track) => !!model.getObjectByName(track.name.split('.')[0]));
      let travel = 0;
      // Strip baked root motion: the clips walk the hips forward and snap back on loop, so the visible body ran
      // ahead of the physics capsule. Pin horizontal hips travel to the first key; keep the vertical bob.
      // The distance it covered is the clip's natural speed, which the stride is matched against.
      for (const track of clip.tracks) {
        if (!/^(mixamorig)?Hips\.position$|^Root\.position$/i.test(track.name)) continue;
        const v = track.values, x = v[0], z = v[2], n = v.length - 3;
        const unit = model.getObjectByName(track.name.split('.')[0])!.parent!.getWorldScale(new T.Vector3()).x / rootScale;
        travel = Math.hypot(v[n] - x, v[n + 2] - z) * unit;
        for (let k = 0; k < v.length; k += 3) { v[k] = x; v[k + 2] = z; }
      }
      if (!clip.tracks.length) continue;
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
      if (ONE_SHOTS[original.name]) this.windows.set(clip.name, ONE_SHOTS[original.name]);
      if (clip.name === 'walk' || clip.name === 'run') this.gait.set(action, this.measureGait(original, action, travel / clip.duration));
    }
    if (this.detailedRig) this.addPoses(model);
    // Everything plays at once; the blend in animateModel decides how much of each shows.
    for (const action of this.actions.values()) {
      action.reset().play(); action.setEffectiveWeight(0);
      if (this.gait.has(action) || !(action === this.actions.get('idle') || action === this.actions.get('guard'))) action.timeScale = 0;
      this.weights.set(action, action === this.actions.get('idle') ? 1 : 0);
    }
  }

  private addPoses(model: T.Object3D): void {
    const idle = this.actions.get('idle'); idle?.play(); this.mixer!.update(0.01); model.updateWorldMatrix(true, true);
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new T.Quaternion()));
    const side = new T.Vector3(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(new T.Quaternion()));
    const rotation = (name: string, axis: T.Vector3, angle: number): T.KeyframeTrack | undefined => {
      const bone = model.getObjectByName(name); if (!bone) return undefined;
      const parent = bone.parent!.getWorldQuaternion(new T.Quaternion());
      const q = parent.clone().invert().multiply(new T.Quaternion().setFromAxisAngle(axis, angle)).multiply(parent).multiply(bone.quaternion);
      return new T.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...q.toArray(), ...q.toArray()]);
    };
    const rotationFrames = (name: string, axis: T.Vector3, angles: number[]): T.KeyframeTrack | undefined => {
      const bone = model.getObjectByName(name); if (!bone) return undefined;
      const parent = bone.parent!.getWorldQuaternion(new T.Quaternion());
      const inverseParent = parent.clone().invert();
      const times = [0, 0.12, 0.42, 0.55];
      const values = angles.flatMap((angle) => inverseParent.clone()
        .multiply(new T.Quaternion().setFromAxisAngle(axis, angle))
        .multiply(parent).multiply(bone.quaternion).toArray());
      return new T.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
    };
    for (const [name, angle] of [['arms-up', 2.7], ['t-pose', 1.5]] as const) {
      const tracks = [rotation('LeftArm', forward, -angle), rotation('RightArm', forward, angle)].filter((track): track is T.KeyframeTrack => !!track);
      this.actions.set(name, this.mixer!.clipAction(new T.AnimationClip(name, 1, tracks)));
    }
    const tracks = [rotation('LeftUpLeg', side, -1.1), rotation('RightUpLeg', side, -1.1), rotation('LeftLeg', side, 1.85), rotation('RightLeg', side, 1.85)].filter((track): track is T.KeyframeTrack => !!track);
    const hips = model.getObjectByName('Hips');
    if (hips) { const p = hips.position.clone(); p.y -= 0.3 / model.scale.y; tracks.push(new T.VectorKeyframeTrack('Hips.position', [0, 1], [...p.toArray(), ...p.toArray()])); }
    this.actions.set('crouch', this.mixer!.clipAction(new T.AnimationClip('crouch', 1, tracks)));

    const rollTracks = [
      rotationFrames('LeftUpLeg', side, [0, -1.25, -1.4, 0]),
      rotationFrames('RightUpLeg', side, [0, -1.25, -1.4, 0]),
      rotationFrames('LeftLeg', side, [0, 1.85, 2.05, 0]),
      rotationFrames('RightLeg', side, [0, 1.85, 2.05, 0]),
      rotationFrames('LeftArm', side, [0, -0.55, -0.75, 0]),
      rotationFrames('RightArm', side, [0, -0.55, -0.75, 0]),
      rotationFrames('LeftForeArm', side, [0, 1.1, 1.4, 0]),
      rotationFrames('RightForeArm', side, [0, 1.1, 1.4, 0]),
    ].filter((track): track is T.KeyframeTrack => !!track);
    this.actions.set('roll', this.mixer!.clipAction(new T.AnimationClip('roll', 0.55, rollTracks)));
    idle?.stop();
  }

  /**
   * Close the right fist round the sword's handle just under the crossguard, blade out of the thumb side and edge in
   * line with the knuckles. The sword is modelled on a diagonal, so its axis, grip end and edge are measured from the
   * mesh rather than assumed. Hand axes for these rigs: fingers +Y, thumb -X, palm -Z.
   */
  holdWeapon(source: T.Object3D, length = 0.95): void {
    const hand = this.model?.getObjectByName('RightHand'); if (!hand) return;
    const blade = measureBlade(source), palm = this.palm(hand);
    const handScale = hand.getWorldScale(new T.Vector3()).x / this.root.getWorldScale(new T.Vector3()).x;
    const scale = length / blade.length;
    const along = new T.Vector3().crossVectors(blade.axis, blade.edge);
    const from = new T.Matrix4().makeBasis(blade.axis, blade.edge, along);
    const to = new T.Matrix4().makeBasis(new T.Vector3(-1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, -1));
    const weapon = new T.Group().add(source.clone(true)), mount = new T.Group(), grip = new T.Group();
    // The fist closes just below the guard, toward the pommel.
    weapon.position.copy(blade.guard).addScaledVector(blade.axis, -0.055 / scale).negate();
    mount.add(weapon); mount.quaternion.setFromRotationMatrix(to.multiply(from.transpose())); mount.scale.setScalar(scale / handScale);
    grip.add(mount); grip.position.copy(palm); hand.add(grip);
    weapon.traverse((part) => { if (part instanceof T.Mesh) part.castShadow = true; });
  }

  /** Where a closed fist would hold a handle, in hand-bone space: across the palm, toward the fingers. */
  private palm(hand: T.Object3D): T.Vector3 {
    let skinned: T.SkinnedMesh | undefined;
    this.model!.traverse((o) => { if (o instanceof T.SkinnedMesh && o.skeleton.bones.includes(hand as T.Bone)) skinned = o; });
    if (!skinned) return new T.Vector3(0, 0.02, 0);
    // Bind-pose vertices into hand space via the inverse bind matrix: independent of whatever pose the rig is in now.
    const index = skinned.skeleton.bones.indexOf(hand as T.Bone);
    const toHand = skinned.skeleton.boneInverses[index].clone().multiply(skinned.bindMatrix);
    const { skinIndex, skinWeight, position } = skinned.geometry.attributes, box = new T.Box3(), v = new T.Vector3();
    for (let i = 0; i < position.count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k);
      if (weight > 0.5) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(toHand));
    }
    if (box.isEmpty()) return new T.Vector3(0, 0.02, 0);
    const size = box.getSize(new T.Vector3());
    return new T.Vector3((box.min.x + box.max.x) / 2, box.min.y + size.y * 0.7, (box.min.z + box.max.z) / 2 - size.z * 0.17);
  }
}

interface Blade { guard: T.Vector3; axis: T.Vector3; edge: T.Vector3; length: number }
const blades = new WeakMap<T.Object3D, Blade>();

/** A sword's crossguard, axis (handle to tip) and edge direction, from its vertices. */
function measureBlade(source: T.Object3D): Blade {
  const cached = blades.get(source); if (cached) return cached;
  const points: T.Vector3[] = [];
  source.updateWorldMatrix(true, true);
  source.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 1) points.push(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  const centre = points.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1 / points.length);
  const farthest = (from: T.Vector3) => points.reduce((best, p) => (p.distanceToSquared(from) > best.distanceToSquared(from) ? p : best), points[0]);
  const a = farthest(centre), b = farthest(a), length = a.distanceTo(b), axis = b.clone().sub(a).normalize();
  // Cross-section radius along the length: the crossguard is the widest part, and it sits nearer the handle.
  const bins = 24, radius = new Array<number>(bins).fill(0);
  for (const p of points) {
    const t = p.clone().sub(a).dot(axis) / length, k = T.MathUtils.clamp(Math.floor(t * bins), 0, bins - 1);
    radius[k] = Math.max(radius[k], p.clone().sub(a).addScaledVector(axis, -t * length).length());
  }
  const guardBin = radius.indexOf(Math.max(...radius.slice(2, bins - 2)));
  const handleAtB = guardBin >= bins / 2;
  const tip = handleAtB ? a : b, pommel = handleAtB ? b : a, toTip = tip.clone().sub(pommel).normalize();
  const guard = a.clone().addScaledVector(axis, length * (guardBin + 0.5) / bins);
  // The blade's flat is thin; its widest spread across the axis is the edge direction.
  const u = new T.Vector3().crossVectors(toTip, Math.abs(toTip.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0)).normalize();
  const w = new T.Vector3().crossVectors(toTip, u);
  let uu = 0, uw = 0, ww = 0;
  for (const p of points) {
    const q = p.clone().sub(guard), out = q.dot(toTip);
    if (out < length * 0.15 || out > length * 0.55) continue;
    const pu = q.dot(u), pw = q.dot(w); uu += pu * pu; uw += pu * pw; ww += pw * pw;
  }
  const theta = 0.5 * Math.atan2(2 * uw, uu - ww);
  const blade = { guard, axis: toTip, edge: u.multiplyScalar(Math.cos(theta)).addScaledVector(w, Math.sin(theta)).normalize(), length };
  blades.set(source, blade);
  return blade;
}
