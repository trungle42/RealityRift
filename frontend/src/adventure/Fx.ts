import * as T from 'three';

/** One GPU particle pool. Additive pools glow (sparks, magic); normal pools read as matter (dust, leaves). */
class Pool {
  readonly points: T.Points;
  private readonly pos: Float32Array; private readonly col: Float32Array; private readonly size: Float32Array; private readonly alpha: Float32Array;
  private readonly vel: Float32Array; private readonly life: Float32Array; private readonly max: Float32Array;
  private readonly base: Float32Array; private readonly grow: Float32Array; private readonly drag: Float32Array; private readonly grav: Float32Array; private readonly sway: Float32Array;
  private cursor = 0;
  constructor(private readonly n: number, additive: boolean) {
    const g = new T.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.base = new Float32Array(n); this.grow = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.sway = new Float32Array(n);
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('size', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    g.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e5);
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, fog: false,
      uniforms: { scale: { value: innerHeight / 2 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vColor; varying float vAlpha; uniform float scale;
        void main(){ vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: additive
        ? `varying vec3 vColor; varying float vAlpha; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 1.8) * vAlpha; if (a < 0.004) discard; gl_FragColor = vec4(vColor * a, a); }`
        : `varying vec3 vColor; varying float vAlpha; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.55, d) * vAlpha; if (a < 0.01) discard; gl_FragColor = vec4(vColor, a); }`,
    });
    this.points = new T.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 20 : 10;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: T.Color, size: number, life: number, opts: { grow?: number; drag?: number; gravity?: number; sway?: number } = {}): void {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([c.r, c.g, c.b], i * 3);
    this.base[i] = size; this.size[i] = size; this.life[i] = life; this.max[i] = life; this.alpha[i] = 1;
    this.grow[i] = opts.grow ?? 0; this.drag[i] = opts.drag ?? 1.5; this.grav[i] = opts.gravity ?? 0; this.sway[i] = opts.sway ?? 0;
  }
  update(dt: number, time: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt; const k = Math.max(0, 1 - this.drag[i] * dt), j = i * 3;
      this.vel[j] *= k; this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt; this.vel[j + 2] *= k;
      const s = this.sway[i] ? Math.sin(time * 3 + i) * this.sway[i] * dt : 0;
      this.pos[j] += this.vel[j] * dt + s; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt + s * 0.7;
      const t = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 14 + 0.25);
      this.size[i] = this.base[i] * (1 + this.grow[i] * (1 - t));
    }
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) g.getAttribute(name).needsUpdate = true;
  }
  resize(): void { (this.points.material as T.ShaderMaterial).uniforms.scale.value = innerHeight / 2; }
}

interface Timed { object: T.Object3D; life: number; max: number; update: (t: number, dt: number) => void }

function gradientArc(): T.ShaderMaterial {
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
    uniforms: { color: { value: new T.Color() }, progress: { value: 0 }, fade: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // u runs along the swing; the bright leading edge sweeps forward with progress, the wake fades behind it.
    fragmentShader: `uniform vec3 color; uniform float progress; uniform float fade; varying vec2 vUv;
      void main(){ float lead = progress * 1.15; float behind = lead - vUv.x; if (behind < 0.0) discard;
        float wake = exp(-behind * 4.5); float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float core = smoothstep(0.62, 0.9, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        float a = (wake * edge * 0.75 + core * wake) * fade; gl_FragColor = vec4(mix(color, vec3(1.0), core * 0.6) * a, a); }`,
  });
}

function textSprite(text: string, color: string, big: boolean): T.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d')!;
  g.font = `${big ? 800 : 700} ${big ? 92 : 72}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 12; g.strokeStyle = 'rgba(20,14,8,0.85)'; g.strokeText(text, 128, 64); g.fillStyle = color; g.fillText(text, 128, 64);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })); s.renderOrder = 40; s.scale.set(1.2, 0.6, 1);
  return s;
}

function reticleTexture(): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.translate(128, 128); g.strokeStyle = 'rgba(255,214,120,0.95)'; g.lineWidth = 7; g.shadowColor = '#ffb347'; g.shadowBlur = 16;
  for (let i = 0; i < 3; i++) { g.rotate(Math.PI * 2 / 3); g.beginPath(); g.moveTo(0, -112); g.lineTo(-20, -78); g.lineTo(20, -78); g.closePath(); g.stroke(); }
  g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.globalAlpha = 0.5; g.stroke();
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}

/** All transient combat and ambience effects. Pooled so a busy fight never allocates per frame. */
export class Fx {
  readonly group = new T.Group();
  private readonly glow = new Pool(3500, true);
  private readonly dust = new Pool(1800, false);
  private readonly timed: Timed[] = [];
  private readonly lights: { light: T.PointLight; life: number; max: number; peak: number }[] = [];
  private readonly reticle: T.Sprite;
  private readonly glint: T.Sprite;
  private readonly c = new T.Color();
  private leafTimer = 0;

  constructor(scene: T.Scene) {
    scene.add(this.group); this.group.add(this.glow.points, this.dust.points);
    // A fixed pool of lights keeps the shader light count constant (no recompiles mid-fight).
    for (let i = 0; i < 4; i++) { const light = new T.PointLight(0xffffff, 0, 9, 2); this.group.add(light); this.lights.push({ light, life: 0, max: 1, peak: 0 }); }
    this.reticle = new T.Sprite(new T.SpriteMaterial({ map: reticleTexture(), transparent: true, depthTest: false, depthWrite: false })); this.reticle.renderOrder = 45; this.reticle.visible = false; this.group.add(this.reticle);
    const glintMap = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, '#fff'); r.addColorStop(0.15, 'rgba(255,90,60,0.9)'); r.addColorStop(1, 'rgba(255,40,20,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.fillRect(60, 4, 8, 120); g.fillRect(4, 60, 120, 8); const t = new T.CanvasTexture(c); return t; })();
    this.glint = new T.Sprite(new T.SpriteMaterial({ map: glintMap, transparent: true, depthTest: false, blending: T.AdditiveBlending })); this.glint.renderOrder = 46; this.glint.visible = false; this.group.add(this.glint);
  }

  resize(): void { this.glow.resize(); this.dust.resize(); }

  sparks(at: T.Vector3, color: T.ColorRepresentation, count: number, speed = 6, size = 0.18, life = 0.5, gravity = 6): void {
    const c = this.c.set(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), s = speed * (0.35 + Math.random() * 0.65);
      this.glow.emit(at.x, at.y, at.z, Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + 1, Math.sin(a) * r * s, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7), { drag: 2.2, gravity });
    }
  }
  /** Soft glowing motes, e.g. magic gathering, starlight rising. */
  motes(at: T.Vector3, color: T.ColorRepresentation, count: number, radius = 1, rise = 1.5, size = 0.22, life = 1.1): void {
    const c = this.c.set(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      this.glow.emit(at.x + Math.cos(a) * r, at.y + Math.random() * 0.4, at.z + Math.sin(a) * r, Math.cos(a) * 0.3, rise * (0.5 + Math.random()), Math.sin(a) * 0.3, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), { drag: 0.8, sway: 0.6 });
    }
  }
  puff(at: T.Vector3, color: T.ColorRepresentation, count = 6, spread = 1.2, size = 0.45, life = 0.7): void {
    const c = this.c.set(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = spread * (0.4 + Math.random() * 0.6);
      this.dust.emit(at.x, at.y + 0.08, at.z, Math.cos(a) * s, 0.35 + Math.random() * 0.5, Math.sin(a) * s, c, size * (0.6 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), { grow: 1.6, drag: 3.2, gravity: -0.2 });
    }
  }
  trail(at: T.Vector3, color: T.ColorRepresentation, size = 0.3): void {
    const c = this.c.set(color);
    this.glow.emit(at.x + (Math.random() - 0.5) * 0.08, at.y + (Math.random() - 0.5) * 0.08, at.z + (Math.random() - 0.5) * 0.08, 0, 0.2, 0, c, size, 0.28, { grow: -0.6, drag: 1 });
  }
  flash(at: T.Vector3, color: T.ColorRepresentation, peak = 14, life = 0.18): void {
    const slot = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    slot.light.position.copy(at); slot.light.color.set(color); slot.peak = peak; slot.life = life; slot.max = life; slot.light.intensity = peak;
  }
  slash(origin: T.Vector3, heading: number, color: T.ColorRepresentation, tilt = 0, radius = 1.6, duration = 0.2, reverse = false): void {
    const arc = Math.PI * 1.15, geo = new T.RingGeometry(radius * 0.35, radius, 28, 1, -arc / 2, arc);
    // Remap UVs: u along the swing direction, v from inner to outer edge.
    const p = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), ang = Math.atan2(y, x), rr = Math.hypot(x, y); let u = (ang + arc / 2) / arc; if (reverse) u = 1 - u; uv.setXY(i, u, (rr - radius * 0.35) / (radius * 0.65)); }
    const mat = gradientArc(); mat.uniforms.color.value.set(color);
    const mesh = new T.Mesh(geo, mat); mesh.renderOrder = 30;
    const holder = new T.Group(); holder.position.copy(origin); holder.rotation.set(0, heading, 0); holder.add(mesh);
    mesh.rotation.set(-Math.PI / 2 + tilt, 0, Math.PI / 2); this.group.add(holder);
    this.timed.push({ object: holder, life: duration + 0.12, max: duration + 0.12, update: (t) => { mat.uniforms.progress.value = Math.min(1, (1 - t) * (duration + 0.12) / duration); mat.uniforms.fade.value = Math.min(1, t * 3.2); } });
  }
  shockwave(at: T.Vector3, color: T.ColorRepresentation, radius = 3, duration = 0.45, thickness = 0.18): void {
    const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const ring = new T.Mesh(new T.RingGeometry(1 - thickness, 1, 48), mat); ring.rotation.x = -Math.PI / 2; ring.position.copy(at); ring.position.y += 0.08; ring.renderOrder = 25; this.group.add(ring);
    this.timed.push({ object: ring, life: duration, max: duration, update: (t) => { const k = 1 - t; ring.scale.setScalar(0.3 + radius * (1 - Math.pow(1 - k, 3))); mat.opacity = 0.85 * t; } });
  }
  number(at: T.Vector3, text: string, color = '#ffe9b0', big = false): void {
    const s = textSprite(text, color, big); s.position.copy(at); this.group.add(s);
    const drift = new T.Vector3((Math.random() - 0.5) * 0.8, 2.2, (Math.random() - 0.5) * 0.8), life = big ? 1.1 : 0.85;
    const bx = big ? 1.7 : 1.2, by = big ? 0.85 : 0.6;
    this.timed.push({ object: s, life, max: life, update: (t, dt) => { s.position.addScaledVector(drift, dt); drift.y -= dt * 3.2; (s.material as T.SpriteMaterial).opacity = Math.min(1, t * 3); const pop = 1 + Math.max(0, (t - 0.8) * 2.5); s.scale.set(bx * pop, by * pop, 1); } });
  }
  /** BotW-style red glint over an enemy that is about to strike. */
  warn(at: T.Vector3): void { this.glint.position.copy(at); this.glint.visible = true; this.glint.userData.life = 0.32; }
  lockOn(target: T.Vector3 | undefined, time: number): void {
    this.reticle.visible = !!target; if (!target) return;
    this.reticle.position.copy(target); (this.reticle.material as T.SpriteMaterial).rotation = time * 1.6;
    const s = 1.5 + Math.sin(time * 7) * 0.08; this.reticle.scale.set(s, s, 1);
  }

  /** Drifting leaves near the camera: the forest always feels alive. */
  ambience(dt: number, around: T.Vector3, forest: boolean): void {
    if (!forest) return;
    this.leafTimer -= dt;
    while (this.leafTimer <= 0) {
      this.leafTimer += 0.22;
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 13, c = this.c.setHSL(0.08 + Math.random() * 0.14, 0.55, 0.36 + Math.random() * 0.15);
      this.dust.emit(around.x + Math.cos(a) * r, around.y + 6 + Math.random() * 3, around.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, -0.5, (Math.random() - 0.5) * 0.6, c, 0.14 + Math.random() * 0.08, 6, { drag: 0.2, gravity: 0.05, sway: 1.4 });
    }
  }

  update(dt: number, time: number): void {
    this.glow.update(dt, time); this.dust.update(dt, time);
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const item = this.timed[i]; item.life -= dt;
      if (item.life <= 0) {
        this.group.remove(item.object);
        item.object.traverse((o) => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose(); const mat = (m as unknown as { material?: T.Material & { map?: T.Texture } }).material; if (mat) { mat.map?.dispose(); mat.dispose(); } });
        this.timed.splice(i, 1); continue;
      }
      item.update(item.life / item.max, dt);
    }
    for (const slot of this.lights) { if (slot.life > 0) { slot.life -= dt; slot.light.intensity = slot.peak * Math.max(0, slot.life / slot.max) ** 2; } else slot.light.intensity = 0; }
    if (this.glint.visible) { const l = (this.glint.userData.life -= dt); const k = Math.max(0, l / 0.32); this.glint.scale.setScalar(0.4 + Math.sin((1 - k) * Math.PI) * 1.6); (this.glint.material as T.SpriteMaterial).rotation = time * 4; if (l <= 0) this.glint.visible = false; }
  }
}
