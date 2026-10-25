import * as T from 'three';

export function material(color: T.ColorRepresentation, emissive?: T.ColorRepresentation): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({ color, roughness: 0.85, emissive: emissive ?? 0x000000, emissiveIntensity: emissive ? 0.65 : 0 });
}

export function mesh(geometry: T.BufferGeometry, mat: T.Material, parent: T.Object3D, x = 0, y = 0, z = 0): T.Mesh {
  const item = new T.Mesh(geometry, mat);
  item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true; parent.add(item);
  return item;
}

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
  attackSerial = 0;
  private playedSerial = -1;
  /** Seconds of hit-reaction animation remaining. */
  stagger = 0;
  /** Roll progress 0..1 while rolling, -1 otherwise: the body tucks and tumbles one full turn forward. */
  roll = -1;
  readonly color: number;
  private model?: T.Object3D;
  private modelBaseY = 0;
  private mixer?: T.AnimationMixer;
  private readonly actions = new Map<string, T.AnimationAction>();
  private activeAction?: T.AnimationAction;
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
      const attackName = this.attack > 0 ? (this.actions.has(this.attackClip) ? this.attackClip : 'strike') : '';
      const name = (this.roll >= 0 && this.actions.has('crouch') ? 'crouch' : '') || this.pose || (this.stagger > 0 && this.actions.has('stagger_back') ? 'stagger_back' : attackName || (this.moving > 6 && this.actions.has('run') ? 'run' : this.moving > 0.1 ? 'walk' : 'idle'));
      const action = this.actions.get(name);
      // A new swing restarts its clip even when chaining the same attack (combo steps).
      if (action && (action !== this.activeAction || (attackName && this.attackSerial !== this.playedSerial))) {
        const blend = attackName ? 0.06 : name === 'stagger_back' ? 0.05 : 0.18;
        if (action === this.activeAction) action.reset(); else { this.activeAction?.fadeOut(blend); action.reset().fadeIn(blend).play(); }
        if (attackName || name === 'stagger_back') { action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; }
        this.activeAction = action; this.playedSerial = this.attackSerial;
      }
      const clip = action?.getClip().duration ?? 1;
      this.mixer.timeScale = attackName ? clip / Math.max(0.2, this.attackLength) : name === 'stagger_back' ? clip / 0.45
        : name === 'walk' ? Math.max(0.65, Math.min(1.6, this.moving / (this.detailedRig ? 3.4 : 4.7))) : name === 'run' ? Math.max(0.8, this.moving / 7) : 1;
      this.mixer.update(dt);
      this.model.visible = this.hurt <= 0 || Math.floor(this.hurt * 12) % 2 === 0;
      const turn = Math.atan2(Math.sin(this.heading - this.root.rotation.y), Math.cos(this.heading - this.root.rotation.y));
      this.root.rotation.y += turn * Math.min(1, dt * 22);
      // Lean into turns and sprints, settle when idle.
      const lean = Math.max(-0.08, Math.min(0.08, -turn * 0.18)) * Math.min(1, this.moving / 5);
      this.model.rotation.z += (lean - this.model.rotation.z) * Math.min(1, dt * 8);
      // Tumble about the hips, dipping low through the middle so the head stays near the ground.
      this.model.rotation.x = this.roll >= 0 ? this.roll * Math.PI * 2 : 0;
      this.model.position.y = this.modelBaseY - (this.roll >= 0 ? Math.sin(this.roll * Math.PI) * 0.45 : 0);
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

  useModel(model: T.Object3D, clips: T.AnimationClip[], companion: boolean, additionalClips: T.AnimationClip[] = []): void {
    this.body.visible = false; this.model = model;
    this.detailedRig = !!model.getObjectByName('LeftArm');
    if (this.detailedRig) {
      const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
      const scale = 1.9 / size.y; model.scale.setScalar(scale); model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    }
    this.root.add(model); this.modelBaseY = model.position.y;
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
    const aliases: Record<string, string> = { walk_forward: 'walk', run_forward: 'run', sword_slash_horizontal: 'strike' };
    for (const original of [...clips, ...additionalClips]) {
      const clip = original.clone(); clip.name = aliases[clip.name] ?? clip.name;
      clip.tracks = clip.tracks.filter((track) => !!model.getObjectByName(track.name.split('.')[0]));
      // Strip baked root motion: the clips walk the hips forward and snap back on loop, so the visible body ran
      // ahead of the physics capsule. Pin horizontal hips travel to the first key; keep the vertical bob.
      for (const track of clip.tracks) {
        if (!/^(mixamorig)?Hips\.position$|^Root\.position$/i.test(track.name)) continue;
        const v = track.values, x = v[0], z = v[2];
        for (let k = 0; k < v.length; k += 3) { v[k] = x; v[k + 2] = z; }
      }
      if (clip.tracks.length && !this.actions.has(clip.name)) this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    if (this.detailedRig) this.addPoses(model);
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
    for (const [name, angle] of [['arms-up', 2.7], ['t-pose', 1.5]] as const) {
      const tracks = [rotation('LeftArm', forward, -angle), rotation('RightArm', forward, angle)].filter((track): track is T.KeyframeTrack => !!track);
      this.actions.set(name, this.mixer!.clipAction(new T.AnimationClip(name, 1, tracks)));
    }
    const tracks = [rotation('LeftUpLeg', side, -1.1), rotation('RightUpLeg', side, -1.1), rotation('LeftLeg', side, 1.85), rotation('RightLeg', side, 1.85)].filter((track): track is T.KeyframeTrack => !!track);
    const hips = model.getObjectByName('Hips');
    if (hips) { const p = hips.position.clone(); p.y -= 0.3 / model.scale.y; tracks.push(new T.VectorKeyframeTrack('Hips.position', [0, 1], [...p.toArray(), ...p.toArray()])); }
    this.actions.set('crouch', this.mixer!.clipAction(new T.AnimationClip('crouch', 1, tracks))); idle?.stop();
  }

  holdWeapon(source: T.Object3D): void {
    const hand = this.model?.getObjectByName('RightHand'); if (!hand) return;
    const weapon = source.clone(true), box = new T.Box3().setFromObject(weapon), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const scale = 0.85 / Math.max(size.x, size.y, size.z);
    weapon.scale.setScalar(scale / (this.model?.scale.y ?? 1)); weapon.position.copy(center).multiplyScalar(-scale);
    const grip = new T.Group(); grip.add(weapon); grip.rotation.z = Math.PI / 2; grip.position.y = 0.08 / (this.model?.scale.y ?? 1); hand.add(grip);
    weapon.traverse((part) => { if (part instanceof T.Mesh) part.castShadow = true; });
  }
}
