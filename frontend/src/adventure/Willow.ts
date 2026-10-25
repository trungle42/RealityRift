import * as T from 'three';

/**
 * Willow, the waykeeper: a willow dryad in a pale green gown, built from shaped geometry to match the storybook art
 * (silver-blond hair, leaf crown, open welcoming arms, sheer bell sleeves and drifting ribbons). She breathes, sways,
 * turns to face a hero who comes close and lifts a hand in greeting. An `echo` is her translucent spirit-self, used
 * where she speaks from afar.
 */
export class Willow {
  readonly root = new T.Group();
  private readonly figure = new T.Group();
  private readonly torso = new T.Group();
  private readonly head = new T.Group();
  private readonly hair = new T.Group();
  private readonly arms: { shoulder: T.Group; elbow: T.Group; sleeve: T.Mesh; side: number }[] = [];
  private readonly skirts: { mesh: T.Mesh; base: Float32Array; height: number; sway: number }[] = [];
  private readonly ribbons: { mesh: T.Mesh; anchor: T.Vector3; side: number; length: number }[] = [];
  private readonly motes: T.Points;
  private readonly moteBase: Float32Array;
  private readonly seed = Math.random() * 10;
  private facing = 0;
  private greet = 0;
  private greeted = false;

  constructor(echo = false) {
    const skin = new T.MeshStandardMaterial({ color: 0xf2d9c4, roughness: 0.55 });
    const gown = new T.MeshStandardMaterial({ color: 0xa9cf9f, roughness: 0.7, side: T.DoubleSide });
    const sheer = new T.MeshStandardMaterial({ color: 0xdff3d6, roughness: 0.6, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false });
    const hair = new T.MeshStandardMaterial({ color: 0xece0c4, roughness: 0.65, side: T.DoubleSide });
    const gold = new T.MeshStandardMaterial({ color: 0xd8b35b, metalness: 0.65, roughness: 0.35 });
    const emerald = new T.MeshStandardMaterial({ color: 0x2fa36b, emissive: 0x1d8a55, emissiveIntensity: 0.7, roughness: 0.2 });
    const leaf = new T.MeshStandardMaterial({ color: 0x7faa63, roughness: 0.7, side: T.DoubleSide });
    const vine = new T.MeshStandardMaterial({ color: 0x5f8a4c, roughness: 0.8 });
    const dark = new T.MeshStandardMaterial({ color: 0x3e5a4a, roughness: 0.4 });
    const white = new T.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.3 });
    const blush = new T.MeshStandardMaterial({ color: 0xeeaaa4, roughness: 0.7, transparent: true, opacity: 0.45, depthWrite: false });
    const lips = new T.MeshStandardMaterial({ color: 0xc97c7a, roughness: 0.45 });

    this.root.add(this.figure);
    this.figure.add(this.torso);
    const add = (geometry: T.BufferGeometry, mat: T.Material, parent: T.Object3D, x = 0, y = 0, z = 0) => {
      const m = new T.Mesh(geometry, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };
    const lathe = (profile: [number, number][], segments = 40, start = 0, length = Math.PI * 2) =>
      new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), segments, start, length);

    // Gown: a fitted bodice over a long flared skirt, then a sheer overskirt split at the front like the art.
    add(lathe([[0.001, 1.43], [0.1, 1.43], [0.15, 1.38], [0.17, 1.29], [0.15, 1.2], [0.125, 1.1], [0.14, 1.04]]), gown, this.torso);
    this.skirt(add(lathe([[0.14, 1.06], [0.2, 0.95], [0.25, 0.7], [0.33, 0.35], [0.42, 0.06], [0.44, 0.0]], 48), gown, this.figure), 1.06, 1);
    this.skirt(add(lathe([[0.15, 1.08], [0.23, 0.95], [0.3, 0.65], [0.42, 0.3], [0.54, 0.02]], 48, 0.42, Math.PI * 2 - 0.84), sheer, this.figure), 1.08, 1.5);
    add(new T.TorusGeometry(0.135, 0.016, 8, 36), gold, this.torso, 0, 1.07).rotation.x = Math.PI / 2;
    add(new T.OctahedronGeometry(0.028), emerald, this.torso, 0, 1.07, 0.145).scale.set(1, 1.35, 0.6);
    // Neckline trim and a small emerald pendant.
    const neckline = add(new T.TorusGeometry(0.135, 0.009, 6, 30, Math.PI), gold, this.torso, 0, 1.4, 0.01);
    neckline.rotation.set(Math.PI / 2 + 0.35, 0, 0);
    add(new T.SphereGeometry(0.016, 10, 8), emerald, this.torso, 0, 1.36, 0.135);

    // Vines trailing down the front of the gown with small leaves.
    for (const side of [-1, 1]) {
      const path = new T.CatmullRomCurve3([[0.05, 1.06, 0.14], [0.09, 0.85, 0.2], [0.07, 0.6, 0.26], [0.12, 0.35, 0.34], [0.1, 0.08, 0.43]]
        .map(([x, y, z]) => new T.Vector3(x * side, y, z)));
      add(new T.TubeGeometry(path, 40, 0.006, 5), vine, this.figure);
      for (let i = 1; i < 12; i++) {
        // Leaves lie flat on the gown, alternating sides of the vine, so they read as leaves rather than thorns.
        const t = i / 12, p = path.getPoint(t), l = add(leafGeometry(0.06), leaf, this.figure, p.x, p.y, p.z + 0.006);
        l.rotation.set(-0.25, side * 0.25, (i % 2 ? 1 : -1) * 0.9 + Math.PI);
      }
    }

    // Shoulders, neck and head.
    for (const side of [-1, 1]) add(new T.SphereGeometry(0.055, 14, 10), skin, this.torso, side * 0.155, 1.4);
    add(new T.CylinderGeometry(0.042, 0.05, 0.12, 14), skin, this.torso, 0, 1.47);
    this.head.position.set(0, 1.6, 0.005); this.torso.add(this.head);
    // Head: an oval skull narrowing to a soft jaw (front of the face at z ~0.095).
    const skull = new T.SphereGeometry(0.1, 32, 24), sp = skull.getAttribute('position');
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i), taper = y < 0 ? 1 - Math.min(1, -y / 0.1) * 0.32 : 1;
      sp.setX(i, sp.getX(i) * 0.88 * taper); sp.setZ(i, sp.getZ(i) * (y < 0 ? 0.96 : 0.98)); sp.setY(i, y * 1.12);
    }
    skull.computeVertexNormals();
    add(skull, skin, this.head);
    for (const side of [-1, 1]) {
      // Almond eyes set on the face: white, green iris, dark pupil and a catch-light so she meets your gaze.
      add(new T.SphereGeometry(0.016, 14, 10), white, this.head, side * 0.033, 0.01, 0.084).scale.set(1.35, 0.72, 0.55);
      add(new T.SphereGeometry(0.0085, 12, 10), emerald, this.head, side * 0.033, 0.009, 0.0915).scale.set(1, 1.05, 0.4);
      add(new T.SphereGeometry(0.0042, 8, 6), dark, this.head, side * 0.033, 0.009, 0.095).scale.set(1, 1, 0.5);
      add(new T.SphereGeometry(0.0018, 6, 4), white, this.head, side * 0.0305, 0.0125, 0.0965);
      // Upper lid line and a fine brow.
      add(new T.CapsuleGeometry(0.0022, 0.03, 3, 6), dark, this.head, side * 0.033, 0.0155, 0.089).rotation.z = Math.PI / 2 - side * 0.12;
      // Brows rise gently toward the middle: kind, not stern.
      add(new T.CapsuleGeometry(0.003, 0.03, 3, 6), hair, this.head, side * 0.035, 0.039, 0.088).rotation.z = Math.PI / 2 - side * 0.12;
      add(new T.SphereGeometry(0.014, 10, 8), blush, this.head, side * 0.05, -0.022, 0.078).scale.set(1, 0.55, 0.25);
      // Pointed dryad ears.
      const ear = add(new T.ConeGeometry(0.015, 0.065, 8), skin, this.head, side * 0.085, 0.002, -0.005);
      ear.rotation.set(0, 0, -side * (Math.PI / 2 - 0.45)); ear.scale.set(1, 1, 0.45);
    }
    add(new T.SphereGeometry(0.009, 10, 8), skin, this.head, 0, -0.016, 0.097).scale.set(0.9, 1.3, 0.9);
    add(new T.CapsuleGeometry(0.0045, 0.022, 3, 8), lips, this.head, 0, -0.046, 0.085).rotation.z = Math.PI / 2;

    // Hair: a cap set back from the forehead, a long silver-blond fall down the back, and locks framing the face.
    this.head.add(this.hair);
    const cap = add(new T.SphereGeometry(0.107, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, this.hair, 0, 0.018, -0.012);
    cap.scale.set(0.95, 1.1, 1.04); cap.rotation.x = -0.42;
    add(lathe([[0.095, 0.04], [0.115, -0.08], [0.15, -0.3], [0.19, -0.6], [0.2, -0.85], [0.15, -0.95], [0.001, -0.9]], 30, Math.PI / 2 + 0.25, Math.PI - 0.5), hair, this.hair, 0, 0, -0.025);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      // From the temple, outside the cheek, over the collarbone: they frame the face rather than hide it.
      const x = 0.078 + i * 0.012, curl = (i % 2 ? 0.015 : -0.01);
      const lock = new T.CatmullRomCurve3([
        new T.Vector3(side * x, 0.07, 0.02 - i * 0.015), new T.Vector3(side * (x + 0.02), -0.04, 0.03 - i * 0.01),
        new T.Vector3(side * (x + 0.05), -0.2, 0.045 + curl), new T.Vector3(side * (x + 0.06 + curl), -0.42, 0.07), new T.Vector3(side * (x + 0.05), -0.62 - i * 0.04, 0.07),
      ]);
      add(new T.TubeGeometry(lock, 28, 0.016 - i * 0.002, 7), hair, this.hair);
    }

    // Crown of gold and green leaves with a central emerald.
    const crown = new T.Group(); crown.position.set(0, 0.085, -0.005); crown.rotation.x = -0.25; this.head.add(crown);
    add(new T.TorusGeometry(0.095, 0.006, 6, 40), gold, crown).rotation.x = Math.PI / 2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, l = add(leafGeometry(i % 2 ? 0.05 : 0.065), i % 3 === 0 ? gold : leaf, crown, Math.sin(a) * 0.095, 0.012, Math.cos(a) * 0.095);
      l.rotation.set(-0.35, a, (i % 2 ? 0.25 : -0.25));
    }
    add(new T.OctahedronGeometry(0.018), emerald, crown, 0, 0.04, 0.1).scale.set(1, 1.5, 0.6);

    // Arms held open in welcome, palms up, with long sheer bell sleeves.
    for (const side of [-1, 1]) {
      const shoulder = new T.Group(); shoulder.position.set(side * 0.165, 1.39, 0); this.torso.add(shoulder);
      add(new T.CapsuleGeometry(0.04, 0.2, 4, 12), skin, shoulder, 0, -0.13);
      const elbow = new T.Group(); elbow.position.y = -0.26; shoulder.add(elbow);
      add(new T.SphereGeometry(0.036, 12, 10), skin, elbow);
      add(new T.CylinderGeometry(0.035, 0.026, 0.22, 12), skin, elbow, 0, -0.115);
      const hand = new T.Group(); hand.position.y = -0.25; elbow.add(hand);
      add(new T.SphereGeometry(0.035, 12, 10), skin, hand, 0, -0.025).scale.set(1, 1.2, 0.45);
      for (let f = 0; f < 4; f++) add(new T.CapsuleGeometry(0.0075, 0.04 - Math.abs(f - 1.5) * 0.006, 3, 6), skin, hand, (f - 1.5) * 0.016, -0.075, 0.004);
      const thumb = add(new T.CapsuleGeometry(0.008, 0.03, 3, 6), skin, hand, -side * 0.03, -0.035, 0.012); thumb.rotation.z = side * 0.7;
      add(new T.TorusGeometry(0.03, 0.006, 6, 18), gold, elbow, 0, -0.2).rotation.x = Math.PI / 2;
      const sleeve = add(lathe([[0.045, 0.0], [0.07, -0.12], [0.12, -0.35], [0.17, -0.62], [0.15, -0.7]], 28, 0, Math.PI * 2), sheer, shoulder, 0, -0.08);
      this.arms.push({ shoulder, elbow, sleeve, side });
    }

    // Two long ribbons drifting from her shoulders, as in the storybook painting.
    for (const side of [-1, 1]) {
      const segments = 24, geometry = new T.PlaneGeometry(0.1, 1, 1, segments);
      const ribbon = add(geometry, sheer, this.figure); ribbon.castShadow = false; ribbon.frustumCulled = false;
      this.ribbons.push({ mesh: ribbon, anchor: new T.Vector3(side * 0.17, 1.38, -0.06), side, length: 1.25 });
    }

    // A soft pool of light at her feet and a few rising motes, so she reads as more than mortal.
    const pool = new T.Mesh(new T.CircleGeometry(0.75, 40), new T.MeshBasicMaterial({ color: 0xc9f0c2, transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.03; this.root.add(pool);
    const points = new Float32Array(18 * 3);
    for (let i = 0; i < points.length; i += 3) { points[i] = (Math.random() - 0.5) * 1.2; points[i + 1] = Math.random() * 2; points[i + 2] = (Math.random() - 0.5) * 1.2; }
    this.moteBase = points.slice();
    const moteGeometry = new T.BufferGeometry(); moteGeometry.setAttribute('position', new T.BufferAttribute(points, 3));
    this.motes = new T.Points(moteGeometry, new T.PointsMaterial({ map: glowDot(), color: 0xe8ffd0, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending }));
    this.motes.frustumCulled = false; this.root.add(this.motes);

    if (echo) {
      // Her echo: the same figure as pale, glowing glass.
      this.root.traverse((o) => {
        if (!(o instanceof T.Mesh) || !(o.material instanceof T.MeshStandardMaterial)) return;
        const m = o.material.clone(); m.transparent = true; m.opacity = Math.min(m.opacity, 0.42); m.depthWrite = false;
        m.emissive = new T.Color(0x9fe6d4); m.emissiveIntensity = 0.55; o.material = m; o.castShadow = false;
      });
    }
    this.update(0, 0);
  }

  /** Remember a skirt's rest shape so its hem can sway; higher layers sway more. */
  private skirt(mesh: T.Mesh, height: number, sway: number): void {
    const base = (mesh.geometry.getAttribute('position').array as Float32Array).slice();
    this.skirts.push({ mesh, base, height, sway });
  }

  /** `focus` is the nearest hero in world space; she turns to them and greets them when they come close. */
  update(dt: number, time: number, focus?: T.Vector3): void {
    const t = time + this.seed;
    // Float a little above the ground and breathe.
    this.figure.position.y = 0.04 + Math.sin(t * 1.1) * 0.018;
    const breath = Math.sin(t * 1.6);
    this.torso.scale.set(1 + breath * 0.008, 1, 1 + breath * 0.012);

    // Turn toward a nearby hero, and lift a hand the first time they approach.
    let lookYaw = 0, lookPitch = 0, near = false;
    if (focus) {
      const local = this.root.worldToLocal(focus.clone());
      const distance = Math.hypot(local.x, local.z);
      near = distance < 6;
      if (near) {
        const yaw = Math.atan2(local.x, local.z);
        this.facing += (T.MathUtils.clamp(yaw, -1.2, 1.2) * 0.6 - this.facing) * Math.min(1, dt * 2);
        lookYaw = T.MathUtils.clamp(yaw - this.facing, -0.7, 0.7);
        lookPitch = T.MathUtils.clamp(Math.atan2(local.y + 1.4 - 1.6, distance) * 0.5, -0.25, 0.2);
      }
    }
    if (!near) { this.facing *= 1 - Math.min(1, dt * 0.8); this.greeted = false; }
    if (near && !this.greeted) { this.greeted = true; this.greet = 2.2; }
    this.greet = Math.max(0, this.greet - dt);
    this.figure.rotation.y = this.facing;
    this.head.rotation.y += (lookYaw + Math.sin(t * 0.5) * 0.08 - this.head.rotation.y) * Math.min(1, dt * 3);
    this.head.rotation.x += (-lookPitch + Math.sin(t * 0.7) * 0.03 - this.head.rotation.x) * Math.min(1, dt * 3);
    this.head.rotation.z = Math.sin(t * 0.45) * 0.06 + 0.04;
    this.hair.rotation.x = Math.sin(t * 0.9) * 0.025 - this.head.rotation.x * 0.3;

    // Arms open in welcome, drifting gently; the right hand rises and waves when greeting.
    const wave = Math.sin(Math.min(1, this.greet / 2.2) * Math.PI);
    for (const arm of this.arms) {
      const drift = Math.sin(t * 0.8 + arm.side) * 0.06, greeting = arm.side > 0 ? wave : 0;
      arm.shoulder.rotation.set(-0.25 - greeting * 1.6, 0, arm.side * (0.55 + drift + greeting * 0.15));
      arm.elbow.rotation.set(-0.9 - greeting * 0.5, arm.side * 0.2, arm.side * (-0.25 + (greeting ? Math.sin(t * 9) * 0.25 * greeting : 0)));
      // The bell sleeve hangs from the upper arm and swings a little behind its motion.
      arm.sleeve.rotation.set(0.6 + greeting * 1.4 + Math.sin(t * 1.3 + arm.side) * 0.08, 0, -arm.side * 0.45);
    }

    // Skirts ripple at the hem in a slow breeze.
    for (const s of this.skirts) {
      const p = s.mesh.geometry.getAttribute('position') as T.BufferAttribute, a = p.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        const x = s.base[i], y = s.base[i + 1], z = s.base[i + 2], low = 1 - y / s.height, angle = Math.atan2(x, z);
        const ripple = Math.sin(t * 1.4 + angle * 3) * 0.022 * low * low * s.sway + Math.sin(t * 0.7) * 0.03 * low * low * s.sway;
        a[i] = x + Math.sin(angle) * ripple + low * low * Math.sin(t * 0.6) * 0.02 * s.sway;
        a[i + 2] = z + Math.cos(angle) * ripple;
      }
      p.needsUpdate = true;
    }

    // Ribbons: hang from the shoulders, sweep out to the side and flutter, fuller toward the free end.
    for (const r of this.ribbons) {
      const p = r.mesh.geometry.getAttribute('position') as T.BufferAttribute, rows = p.count / 2;
      for (let row = 0; row < rows; row++) {
        const u = row / (rows - 1), s = u * r.length;
        const out = r.side * (0.15 * u + 0.35 * u * u + Math.sin(t * 1.5 + u * 4) * 0.08 * u);
        const back = -0.12 * u - Math.sin(t * 1.1 + u * 3 + r.side) * 0.1 * u;
        const cx = r.anchor.x + out, cy = r.anchor.y - s * 0.9, cz = r.anchor.z + back;
        const width = 0.05 + u * 0.05, twist = Math.sin(t * 1.7 + u * 5) * 0.6;
        for (let k = 0; k < 2; k++) {
          const w = (k ? 1 : -1) * width;
          p.setXYZ(row * 2 + k, cx + Math.cos(twist) * w * 0.4, cy, cz + Math.sin(twist) * w);
        }
      }
      p.needsUpdate = true; r.mesh.geometry.computeVertexNormals();
    }

    const motes = this.motes.geometry.getAttribute('position') as T.BufferAttribute;
    for (let i = 0; i < motes.count; i++) {
      const j = i * 3, rise = (this.moteBase[j + 1] + t * 0.25) % 2.2;
      motes.setXYZ(i, this.moteBase[j] + Math.sin(t + i) * 0.1, rise, this.moteBase[j + 2] + Math.cos(t * 0.8 + i) * 0.1);
    }
    motes.needsUpdate = true;
  }
}

/** A soft round sprite for the motes (plain points draw as squares). No canvas outside the browser, e.g. in tests. */
function glowDot(): T.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d')!, r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(240,255,220,0.6)'); r.addColorStop(1, 'rgba(220,255,200,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new T.CanvasTexture(canvas);
}

/** A single willow leaf: a pointed oval, flat, with its stem at the origin. */
function leafGeometry(length: number): T.ShapeGeometry {
  const w = length * 0.32, shape = new T.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(w, length * 0.35, 0, length);
  shape.quadraticCurveTo(-w, length * 0.35, 0, 0);
  return new T.ShapeGeometry(shape, 6);
}
