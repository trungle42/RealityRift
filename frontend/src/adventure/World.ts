import * as T from 'three';
import type { EnvironmentId } from '../contracts';
import { REGIONS } from '../campaign/locations';
import { material, mesh } from './Actor';
import { CENTERS, heightAt, pathDistance, type Position, type Solid } from './terrain';

export interface WorldObject extends Position {
  id: string; name: string; kind: 'chest' | 'shrine' | 'lore'; detail?: string;
  root: T.Group; used: boolean; lid?: T.Group;
}
export interface Shard { mesh: T.Mesh; baseY: number; taken: boolean }
const seededRandom = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const stone = material(0xb7c3a6), pale = material(0xe8e4c7), gold = material(0xb99b56);

export class World {
  private readonly random = seededRandom(8317);
  readonly root = new T.Group();
  readonly solids: Solid[] = [];
  readonly treeSolids: (Solid & { y: number })[] = [];
  readonly objects: WorldObject[] = [];
  readonly shards: Shard[] = [];
  readonly marker = new T.Group();
  readonly particles: T.Points;
  private readonly markerGem: T.Mesh;
  private readonly water: T.Mesh;
  private readonly flags: T.Mesh[] = [];
  private readonly lights: T.Mesh[] = [];
  private readonly lanterns = new Map<EnvironmentId, T.Group>();
  private readonly archSlots: T.Group[] = [];
  private readonly forestMeshes: T.InstancedMesh[] = [];
  private readonly treeTransforms: T.Matrix4[] = [];
  private ground?: T.Mesh;
  private readonly shafts: T.MeshBasicMaterial[] = [];
  /** Stylized lake: animated ripples, fresnel sky reflection, sun glint, shallow-to-deep tint, shoreline foam. */
  private readonly waterMaterial = new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {
      time: { value: 0 }, center: { value: new T.Vector2(30, 24) }, sunDir: { value: new T.Vector3(-34, 40, 22).normalize() },
      deep: { value: new T.Color(0x245f63) }, shallow: { value: new T.Color(0x8fcfbf) }, sky: { value: new T.Color(0xdbe8dc) },
    }]),
    vertexShader: `varying vec3 vWorld; #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition; #include <fog_vertex> }`.replace(/#include <(\w+)>/g, '\n#include <$1>\n'),
    fragmentShader: `uniform float time; uniform vec2 center; uniform vec3 sunDir; uniform vec3 deep; uniform vec3 shallow; uniform vec3 sky; varying vec3 vWorld; #include <common> #include <fog_pars_fragment>
      void main(){
        vec2 p = vWorld.xz; float t = time;
        vec2 g = vec2(cos(p.x * 0.9 + t * 1.3), cos(p.y * 0.8 + t * 1.1)) * 0.12
               + vec2(cos((p.x + p.y) * 1.7 + t * 2.1), cos((p.x - p.y) * 1.5 + t * 1.7)) * 0.06
               + vec2(cos(p.x * 3.7 - t * 2.9), cos(p.y * 4.1 + t * 2.3)) * 0.03;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y)), v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        float r = distance(p, center), depth = smoothstep(16.5, 9.0, r);
        vec3 col = mix(mix(shallow, deep, depth), sky, fres * 0.7);
        vec3 h = normalize(sunDir + v); float nh = max(dot(n, h), 0.0);
        col += vec3(1.0, 0.9, 0.68) * (pow(nh, 260.0) * 2.6 + pow(nh, 30.0) * 0.12);
        float foam = smoothstep(15.6, 16.7, r) * (0.55 + 0.45 * sin(r * 8.0 - t * 1.8 + p.x * 0.5));
        col = mix(col, vec3(0.96, 0.98, 0.95), foam * 0.55);
        gl_FragColor = vec4(col, mix(0.62, 0.93, depth) + fres * 0.08 + foam * 0.2);
        #include <fog_fragment>
      }`.replace(/#include <(\w+)>/g, '\n#include <$1>\n'),
  });
  private readonly wind = { value: 0 };
  private readonly moteBase: Float32Array;
  private readonly lampSlots: T.Group[] = [];
  private readonly waystone = new T.Group();

  constructor(scene: T.Scene) {
    scene.add(this.root);
    this.terrain(); this.woodland(); this.approach(); this.castle(); this.cave(); this.ruins();
    this.placeObjects(); this.storyLandmarks(); this.sunShafts();
    this.water = mesh(new T.CircleGeometry(17, 96), this.waterMaterial, this.root, 30, -0.08, 24);
    this.water.rotation.x = -Math.PI / 2; this.water.castShadow = false; this.water.receiveShadow = false; this.water.name = 'lake'; this.water.renderOrder = 2;
    const bridge = new T.Group(); bridge.position.set(16, 0.4, 24); this.root.add(bridge);
    for (let i = 0; i < 12; i++) mesh(new T.BoxGeometry(2.5, 0.13, 0.38), material(0xa18b64), bridge, 0, Math.sin(i / 11 * Math.PI) * 0.7, -2.2 + i * 0.4);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) mesh(new T.CylinderGeometry(0.08, 0.1, 1.5, 6), material(0x6f6546), bridge, side * 1.22, 0.75, -2.2 + i * 1.45);

    this.markerGem = mesh(new T.OctahedronGeometry(0.4), material(0xffe7a1, 0xffcc62), this.marker, 0, 3.3);
    const ring = mesh(new T.TorusGeometry(0.8, 0.035, 5, 40), material(0xf5d58a, 0xdcc367), this.marker, 0, 0.12);
    ring.rotation.x = Math.PI / 2;
    const beam = mesh(new T.CylinderGeometry(0.07, 0.55, 9, 14, 1, true), new T.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.1, side: T.DoubleSide, depthWrite: false }), this.marker, 0, 4.5);
    beam.castShadow = false; this.root.add(this.marker);
    const points = new Float32Array(270 * 3);
    for (let i = 0; i < points.length; i += 3) { points[i] = (this.random() - 0.5) * 140; points[i + 1] = this.random() * 8 + 0.8; points[i + 2] = (this.random() - 0.5) * 130; }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(points, 3)); this.moteBase = points.slice();
    // Glowing pollen / fireflies: soft additive sprites that drift and twinkle.
    let map: T.Texture | null = null;
    if (typeof document !== 'undefined') {
      const glow = document.createElement('canvas'); glow.width = glow.height = 64; const g = glow.getContext('2d')!;
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,240,190,0.8)'); r.addColorStop(1, 'rgba(255,220,140,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      map = new T.CanvasTexture(glow);
    }
    this.particles = new T.Points(geometry, new T.PointsMaterial({ map, color: 0xffe3a0, size: 0.42, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending }));
    this.particles.frustumCulled = false; this.root.add(this.particles);
  }

  private terrain(): void {
    const geo = new T.PlaneGeometry(260, 260, 180, 180); geo.rotateX(-Math.PI / 2);
    const positions = geo.getAttribute('position'), colors = new Float32Array(positions.count * 3), weights = new Float32Array(positions.count);
    const green = new T.Color(0x7b965b), meadow = new T.Color(0x9aa975), path = new T.Color(0xd5c8a2);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i); let y = heightAt(x, z);
      const border = Math.max(0, Math.abs(x) - 62) + Math.max(0, -z - 68) + Math.max(0, z - 65);
      y += border * 0.22 + Math.max(0, border - 10) * Math.sin(x * 0.1 + z * 0.11) * 0.22;
      positions.setY(i, y);
      const noise = (Math.sin(x * 7.3 + z * 4.1) + 1) * 0.12;
      const color = green.clone().lerp(meadow, 0.4 + noise);
      const d = pathDistance(x, z);
      weights[i] = Math.max(0, Math.min(1, (3 - d) / 1.5));
      if (d < 2.3) color.lerp(path, Math.max(0, 1 - Math.max(0, d - 1.2) / 1.1));
      if (z < -32 && x < -25) color.lerp(new T.Color(0xbebda1), 0.55);
      if (z < -32 && x > 25) color.lerp(new T.Color(0x7e9594), 0.7);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(colors, 3)); geo.setAttribute('pathWeight', new T.BufferAttribute(weights, 1)); geo.computeVertexNormals();
    this.ground = mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), this.root); this.ground.castShadow = false; this.ground.name = 'ground';
    // Layered, hazy ridgelines (forested near ridge, blue far range) instead of single peaks:
    // the fog turns them into the painted horizon of Rishaan's backdrops.
    this.horizonBand(116, -7, 24, 6, 0x4f6e4c, 0x7d9a76, 1.3, 0.55);
    this.horizonBand(152, -10, 52, 3, 0x7f9fa6, 0xd7e2dc, 4.1, 0.25);
  }

  private horizonBand(radius: number, base: number, height: number, freq: number, bottom: number, top: number, seed: number, jag: number): void {
    const seg = 320, rows = 5, positions: number[] = [], colors: number[] = [], index: number[] = [];
    const c0 = new T.Color(bottom), c1 = new T.Color(top), c = new T.Color();
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      const n = 0.5 + 0.5 * (Math.sin(a * freq + seed) * 0.5 + Math.sin(a * freq * 2.7 + seed * 1.7) * 0.3 + Math.sin(a * freq * 7.3 + seed * 0.4) * 0.2);
      const crown = jag * (Math.sin(a * 140 + seed) * 0.5 + Math.sin(a * 97) * 0.5) * 0.06 * height; // treeline texture
      const h = height * (0.3 + 0.7 * n) + crown;
      for (let j = 0; j <= rows; j++) {
        const v = j / rows, r = radius * (1 - v * 0.05);
        positions.push(Math.sin(a) * r, base + h * Math.pow(v, 0.85), Math.cos(a) * r);
        c.copy(c0).lerp(c1, v); colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < rows; j++) { const a = i * (rows + 1) + j, b = a + rows + 1; index.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); geo.setIndex(index); geo.computeVertexNormals();
    const band = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide })); band.userData.physics = false; band.userData.noFade = true; band.name = 'horizon';
    this.root.add(band);
  }

  /** Golden light shafts falling into the clearings, after the warm volumetric rays of Rishaan's forest painting. */
  private sunShafts(): void {
    if (typeof document === 'undefined') return; // headless (unit tests): no canvas textures
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d')!;
    const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.35, 'rgba(255,255,255,0.8)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, 64, 256);
    const h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 64, 256);
    const map = new T.CanvasTexture(c);
    const sun = new T.Vector3(-34, 40, 22).normalize(), up = new T.Vector3(0, 1, 0);
    for (const [x, z, w] of [[-6, 10, 4], [8, 16, 3], [-12, -4, 5], [10, -10, 3.5], [2, 29, 3], [18, 3, 4], [-17, 18, 3], [4, -2, 2.5]]) {
      const mat = new T.MeshBasicMaterial({ map, color: 0xffdf9e, transparent: true, opacity: 0.12, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
      const group = new T.Group(); group.position.set(x, heightAt(x, z) + 10, z); group.quaternion.setFromUnitVectors(up, sun); group.userData.physics = false;
      for (const r of [0, Math.PI / 2]) { const plane = new T.Mesh(new T.PlaneGeometry(w, 24), mat); plane.rotation.y = r; plane.renderOrder = 5; group.add(plane); }
      this.root.add(group); this.shafts.push(mat);
    }
  }

  private woodland(): void {
    const trunkGeometry = new T.CylinderGeometry(0.25, 0.5, 4.6, 6), leafGeometry = new T.IcosahedronGeometry(1, 1);
    const trunks = new T.InstancedMesh(trunkGeometry, material(0x71634a), 210);
    const leaves = new T.InstancedMesh(leafGeometry, material(0x739249), 630);
    const matrix = new T.Object3D(); let count = 0;
    for (let attempt = 0; count < 210 && attempt < 4000; attempt++) {
      const x = (this.random() - 0.5) * 180, z = (this.random() - 0.5) * 170;
      if (pathDistance(x, z) < 5 || Math.hypot(x, z - 30) < 16 || Math.hypot(x - 30, z - 24) < 22 || (z < -28 && Math.abs(x) > 26 && Math.abs(x) < 59)) continue;
      const y = heightAt(x, z), scale = 0.8 + this.random() * 1.25;
      matrix.position.set(x, y + scale * 2.3, z); matrix.scale.setScalar(scale); matrix.rotation.set(0, this.random() * 6, (this.random() - 0.5) * 0.12); matrix.updateMatrix(); trunks.setMatrixAt(count, matrix.matrix);
      const atGround = matrix.matrix.clone(); atGround.elements[13] -= scale * 2.3; this.treeTransforms.push(atGround);
      for (let c = 0; c < 3; c++) {
        matrix.position.set(x + (c - 1) * 1.1 * scale, y + (5.5 + (c === 1 ? 1.3 : 0)) * scale, z + (this.random() - 0.5) * 1.4);
        matrix.scale.set(2.1 * scale, (1.6 + this.random() * 0.5) * scale, 2.1 * scale); matrix.updateMatrix(); leaves.setMatrixAt(count * 3 + c, matrix.matrix);
        leaves.setColorAt(count * 3 + c, new T.Color().setHSL(0.18 + this.random() * 0.10, 0.32 + this.random() * 0.1, 0.35 + this.random() * 0.15));
      }
      // Collider matches the oak's trunk plus the inner root flare, so heroes stop at the bark instead of sinking in.
      if (Math.abs(x) < 68 && z > -70 && z < 59) {
        const solid = { x, y, z, radius: 0.66 * scale }; this.solids.push(solid); this.treeSolids.push(solid);
      }
      count++;
    }
    trunks.count = count; leaves.count = count * 3;
    trunks.castShadow = true; leaves.castShadow = true; this.root.add(trunks, leaves); this.forestMeshes.push(trunks, leaves);

    const grassGeo = new T.BufferGeometry(), blades: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = i * 2.4, c = Math.cos(a), s = Math.sin(a), h = 0.18 + i * 0.035;
      const point = (x: number, y: number, z: number) => [x * c - z * s, y, x * s + z * c];
      blades.push(...point(-0.035, 0, 0), ...point(0.035, 0, 0), ...point(0.015, h * 0.6, 0.025), ...point(-0.035, 0, 0), ...point(0.015, h * 0.6, 0.025), ...point(-0.015, h * 0.6, 0.025), ...point(-0.015, h * 0.6, 0.025), ...point(0.015, h * 0.6, 0.025), ...point(0.04, h, 0.08));
    }
    grassGeo.setAttribute('position', new T.Float32BufferAttribute(blades, 3)); grassGeo.computeVertexNormals();
    const grassMat = new T.MeshStandardMaterial({ color: 0x7e9556, side: T.DoubleSide, roughness: 1 });
    // Wind ripples travel across the meadow: blades bend more at the tip.
    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = this.wind;
      shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float gust = sin(uWind * 1.6 + ip.x * 0.31 + ip.y * 0.23) * 0.6 + sin(uWind * 3.3 + ip.x * 1.1 - ip.y * 0.7) * 0.25;
        transformed.x += gust * position.y * 1.1; transformed.z += gust * position.y * 0.55;`);
    };
    const grass = new T.InstancedMesh(grassGeo, grassMat, 9000);
    for (let i = 0; i < 9000; i++) {
      const x = (this.random() - 0.5) * 135, z = (this.random() - 0.5) * 130;
      const s = pathDistance(x, z) < 2.7 || heightAt(x, z) < -0.2 ? 0 : 0.45 + this.random() * 0.8;
      matrix.position.set(x, heightAt(x, z), z); matrix.rotation.set(0, this.random() * 6, 0); matrix.scale.setScalar(s); matrix.updateMatrix(); grass.setMatrixAt(i, matrix.matrix);
    }
    this.root.add(grass);
    const flowers = new T.InstancedMesh(new T.IcosahedronGeometry(0.055, 1), material(0xf7e6b4), 480);
    for (let i = 0; i < 480; i++) {
      const x = (this.random() - 0.5) * 105, z = (this.random() - 0.5) * 100;
      matrix.position.set(x, heightAt(x, z) + 0.14, z); matrix.scale.setScalar(heightAt(x, z) < -0.1 || pathDistance(x, z) < 3 ? 0 : 1); matrix.updateMatrix(); flowers.setMatrixAt(i, matrix.matrix);
      flowers.setColorAt(i, new T.Color([0xffedb0, 0xead4eb, 0xf1bd96, 0xd4e5ed][i % 4]));
    }
    this.root.add(flowers);
    // Starlight gathers around old magic, rewarding a deliberate detour.
    for (let i = 0; i < 18; i++) {
      const cluster = [{ x: -9, z: 7 }, { x: -10, z: -3 }, { x: 15, z: 24 }][Math.floor(i / 6)];
      const angle = i % 6 / 6 * Math.PI * 2, radius = 2.7;
      const x = cluster.x + Math.sin(angle) * radius, z = cluster.z + Math.cos(angle) * radius;
      if (heightAt(x, z) < 0) continue;
      const shard = mesh(new T.OctahedronGeometry(0.17), material(0xffe2a3, 0xf9c86c), this.root, x, heightAt(x, z) + 0.65, z);
      shard.userData.physics = false;
      this.shards.push({ mesh: shard, baseY: shard.position.y, taken: false });
    }
  }

  private approach(): void {
    for (const x of [-4, 4]) for (let z = 23; z < 38; z += 10) {
      const group = new T.Group(); group.position.set(x, heightAt(x, z), z); this.root.add(group);
      mesh(new T.CylinderGeometry(0.055, 0.085, 2.5, 10), material(0x605b47), group, 0, 1.25);
      const slot = new T.Group(); slot.position.y = 2.25; group.add(slot); this.lampSlots.push(slot);
    }
  }

  private castle(): void {
    const castle = new T.Group(); castle.position.set(-40, 0, -55); this.root.add(castle);
    for (const x of [-10, 10]) for (const z of [-7, 6]) {
      const tower = new T.Group(); tower.position.set(x, 0, z); castle.add(tower);
      mesh(new T.CylinderGeometry(2.1, 2.6, 13, 10), pale, tower, 0, 6.5);
      mesh(new T.CylinderGeometry(2.4, 2.4, 0.6, 10), stone, tower, 0, 12.5);
      mesh(new T.ConeGeometry(3.2, 5, 10), material(0x698c86), tower, 0, 15.5);
      mesh(new T.CylinderGeometry(0.04, 0.06, 3.5, 5), gold, tower, 0, 19);
      const flag = mesh(new T.PlaneGeometry(1.6, 0.85, 5, 2), new T.MeshStandardMaterial({ color: 0xcc9978, side: T.DoubleSide }), tower, 0.8, 20); this.flags.push(flag);
      mesh(new T.BoxGeometry(0.65, 2.2, 0.06), material(0x738980), tower, 0, 9.5, 2.07);
      this.solids.push({ x: -40 + x, z: -55 + z, radius: 2.5 });
    }
    mesh(new T.BoxGeometry(15, 9, 2), pale, castle, 0, 4.5, -7);
    mesh(new T.BoxGeometry(2, 7, 11), pale, castle, -10, 3.5, -0.5);
    mesh(new T.BoxGeometry(2, 7, 11), pale, castle, 10, 3.5, -0.5);
    for (let x = -8; x <= 8; x += 2) mesh(new T.BoxGeometry(1, 1, 2.2), pale, castle, x, 9.2, -7);
    // Open front arch: the hero can physically enter the courtyard.
    for (const x of [-5, 5]) mesh(new T.BoxGeometry(5, 7, 1.8), pale, castle, x, 3.5, 6);
    mesh(new T.BoxGeometry(15, 2.4, 1.8), pale, castle, 0, 8.2, 6);
    mesh(new T.TorusGeometry(2.5, 0.34, 6, 24, Math.PI), stone, castle, 0, 5.6, 7);
    this.solids.push({ x: -40, z: -62, radius: 3 });
    // Wall spans are continuous; the central arch stays open.
    for (let x = -7; x <= 7; x += 1.4) {
      this.solids.push({ x: -40 + x, z: -62, radius: 1.05 });
      if (Math.abs(x) > 2.8) this.solids.push({ x: -40 + x, z: -49, radius: 1.05 });
    }
    for (let z = -61; z <= -49; z += 1.4) for (const x of [-50, -30]) this.solids.push({ x, z, radius: 1.05 });
  }

  private cave(): void {
    const group = new T.Group(); group.position.set(40, 0, -48); this.root.add(group);
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 1.6 + Math.PI * 0.2, x = Math.sin(angle) * 12, z = Math.cos(angle) * 10;
      const size = 5.6 + this.random() * 2, lift = 3 + this.random() * 2, footprint = size * 0.7;
      // Keep the guardian's arena (40, -55) and every cave landmark clear of boulders.
      const keepClear = [{ x: 40, z: -55, r: 6.5 }, ...REGIONS.cave.landmarks.filter((l) => ['chest', 'shrine', 'lore'].includes(l.kind)).map((l) => ({ x: CENTERS.cave.x + (l.x - 650) * 0.035, z: CENTERS.cave.z + (l.y - 510) * 0.045, r: 2.4 }))];
      if (keepClear.some((k) => Math.hypot(40 + x - k.x, -48 + z - k.z) < footprint + k.r)) continue;
      const rock = mesh(new T.DodecahedronGeometry(size, 0), material(0x748f8d), group, x, lift, z);
      rock.scale.set(0.8, 1.5, 0.85); this.solids.push({ x: 40 + x, z: -48 + z, radius: footprint });
    }
    for (let i = 0; i < 30; i++) {
      const angle = this.random() * Math.PI * 2, r = 4 + this.random() * 8;
      const x = Math.sin(angle) * r, z = Math.cos(angle) * r;
      if (Math.abs(x) < 2.5) continue;
      const crystal = mesh(new T.ConeGeometry(0.4 + this.random() * 0.5, 2 + this.random() * 3, 5), material(i % 2 ? 0x8ac6c9 : 0xb9a3d6, 0x3b7377), group, x, 1.5, z);
      crystal.rotation.z = (this.random() - 0.5) * 0.7;
    }
    group.add(new T.PointLight(0x70d6ed, 35, 25));
  }

  private ruins(): void {
    const shrine = new T.Group(); shrine.position.set(0, heightAt(0, 4), 4); this.root.add(shrine);
    this.archSlots.push(shrine);
    for (const x of [-3, 3]) {
      mesh(new T.CylinderGeometry(0.45, 0.6, 4.5, 7), stone, shrine, x, 2.25);
      mesh(new T.BoxGeometry(1.3, 0.4, 1.3), pale, shrine, x, 4.5);
    }
    mesh(new T.BoxGeometry(7.5, 0.6, 1.1), stone, shrine, 0, 4.9);
    const seal = mesh(new T.TorusGeometry(1.35, 0.07, 6, 48), material(0xb4eee3, 0x6ddbc7), shrine, 0, 2.2); this.lights.push(seal);
    for (const x of [-1, 1]) {
      const sign = new T.Group(); sign.position.set(x * 2.4, heightAt(x * 2.4, -14), -14); this.root.add(sign);
      mesh(new T.CylinderGeometry(0.1, 0.13, 2.2, 6), material(0x71634a), sign, 0, 1.1);
      const plank = mesh(new T.BoxGeometry(2, 0.48, 0.16), material(0xb9a375), sign, x * 0.45, 1.9); plank.rotation.z = x * 0.12;
    }
    // Stepping stones encourage small detours away from the main quest.
    for (let i = 0; i < 24; i++) {
      const x = -8 + Math.sin(i * 0.4) * 2, z = 20 - i * 0.9;
      const rock = mesh(new T.CylinderGeometry(0.8, 1, 0.14, 6), stone, this.root, x, heightAt(x, z), z); rock.rotation.y = i;
    }
  }

  private storyLandmarks(): void {
    const waystone = this.waystone; waystone.position.set(0, heightAt(0, 22), 22); this.root.add(waystone);
    const slab = mesh(new T.DodecahedronGeometry(0.85, 0), stone, waystone, 0, 0.9); slab.scale.set(0.7, 1.4, 0.45);
    mesh(new T.TorusGeometry(0.23, 0.025, 5, 20), material(0xffe5a2, 0xc8b77d), waystone, 0, 1.2, 0.39);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; mesh(new T.BoxGeometry(0.5, 0.12, 0.7), stone, waystone, Math.sin(a) * 1.5, 0.05, Math.cos(a) * 1.5).rotation.y = a; }

    // The forest spirit's ancient tree is the source of the Moonpetal Charm.
    const tree = new T.Group(); tree.position.set(-10, heightAt(-10, -3), -3); this.root.add(tree);
    mesh(new T.CylinderGeometry(0.65, 1.1, 5.5, 8), material(0x796c56), tree, 0, 2.75);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      const branch = mesh(new T.CylinderGeometry(0.12, 0.3, 3.8, 6), material(0x796c56), tree, Math.sin(a) * 0.9, 4.8, Math.cos(a) * 0.9); branch.rotation.z = Math.sin(a) * 0.7; branch.rotation.x = Math.cos(a) * 0.7;
      const canopy = mesh(new T.IcosahedronGeometry(2.4, 1), material(0xc4b5c2), tree, Math.sin(a) * 2, 6 + i % 2, Math.cos(a) * 2); canopy.scale.y = 0.65;
      const root = mesh(new T.ConeGeometry(0.25, 2.2, 5), material(0x796c56), tree, Math.sin(a) * 0.75, 0.25, Math.cos(a) * 0.75); root.rotation.z = Math.sin(a) * 1.3; root.rotation.x = Math.cos(a) * 1.3;
    }
    const charm = mesh(new T.OctahedronGeometry(0.2), material(0xf9e5ae, 0xc9ac69), tree, 0, 1.6, 1.1); this.lights.push(charm);
    charm.userData.physics = false;
    for (const env of ['castle', 'cave'] as const) {
      const center = CENTERS[env];
      // Gate, captive lantern, and final arena are physically on the chosen route.
      const gate = new T.Group(); gate.position.set(center.x, heightAt(center.x, center.z + 12), center.z + 12); this.root.add(gate);
      this.archSlots.push(gate);
      for (const x of [-2.1, 2.1]) mesh(new T.BoxGeometry(0.65, 3.8, 0.75), stone, gate, x, 1.9);
      mesh(new T.TorusGeometry(2.1, 0.35, 6, 24, Math.PI), pale, gate, 0, 3.7);
      const rune = mesh(new T.TorusGeometry(0.75, 0.035, 5, 32), material(0xa5e8d6, 0x539e83), gate, 0, 2.2); this.lights.push(rune);
      const lantern = new T.Group(); lantern.position.set(center.x, heightAt(center.x, center.z), center.z); this.root.add(lantern);
      mesh(new T.CylinderGeometry(0.1, 0.15, 2.6, 6), material(0x766b51), lantern, -0.85, 1.3);
      mesh(new T.BoxGeometry(1.25, 0.12, 0.13), material(0x766b51), lantern, -0.3, 2.6);
      for (const y of [1.55, 2.35]) mesh(new T.CylinderGeometry(0.42, 0.42, 0.07, 8), gold, lantern, 0.2, y);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mesh(new T.CylinderGeometry(0.025, 0.025, 0.8, 5), gold, lantern, 0.2 + Math.sin(a) * 0.35, 1.95, Math.cos(a) * 0.35); }
      const fairy = mesh(new T.SphereGeometry(0.13, 10, 8), material(0xf7d4e6, 0xe9aacb), lantern, 0.2, 1.95); fairy.name = 'trapped-fairy'; fairy.userData.physics = false;
      for (const side of [-1, 1]) { const wing = mesh(new T.SphereGeometry(0.2, 8, 5), material(0xd7edf4, 0x6f9691), lantern, 0.2 + side * 0.16, 2, -0.04); wing.scale.set(0.5, 1, 0.15); wing.name = 'trapped-fairy'; wing.userData.physics = false; }
      this.lanterns.set(env, lantern);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; mesh(new T.CylinderGeometry(0.65, 0.75, 0.14, 6), stone, this.root, center.x + Math.sin(a) * 6, heightAt(center.x, center.z - 11) + 0.03, center.z - 11 + Math.cos(a) * 6); }
    }
  }

  freeFairy(env: EnvironmentId): void { this.lanterns.get(env)?.traverse((part) => { if (part.name === 'trapped-fairy') part.visible = false; }); }

  useArchModel(source: T.Object3D): void {
    this.archSlots.forEach((slot) => {
      slot.clear(); const model = source.clone(true); model.scale.setScalar(0.9);
      model.traverse((object) => { if (object instanceof T.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      slot.add(model);
      for (const side of [-1, 1]) this.solids.push({ x: slot.position.x + side * 1.89, z: slot.position.z, radius: 0.5 });
    });
    // The grove was once one sanctuary: broken perimeter walls share the gate's stonework.
    for (const [x, z, rotation, scale] of [[-8, 13, 0.3, 0.48], [9, 8, -0.5, 0.55], [-11, 0, 0.8, 0.38], [9, -8, -0.2, 0.42]]) {
      const model = source.clone(true); model.scale.setScalar(scale); model.position.set(x, heightAt(x, z), z); model.rotation.y = rotation;
      model.traverse((object) => { if (object instanceof T.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      this.root.add(model);
      for (const side of [-1, 1]) this.solids.push({ x: x + Math.cos(rotation) * side * 2.1 * scale, z: z - Math.sin(rotation) * side * 2.1 * scale, radius: 0.4 * scale });
    }
  }

  useMoonwellModel(source: T.Object3D): void {
    this.objects.filter((object) => object.kind === 'shrine').forEach((object) => {
      object.root.clear(); const model = source.clone(true); model.traverse((part) => { if (part instanceof T.Mesh) { part.castShadow = true; part.receiveShadow = true; } }); object.root.add(model);
    });
  }

  private fitted(source: T.Object3D, height: number): T.Object3D {
    const model = source.clone(true), box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const factor = height / size.y, wrapper = new T.Group();
    model.scale.multiplyScalar(factor); model.position.set(-center.x * factor, -box.min.y * factor, -center.z * factor); wrapper.add(model);
    model.traverse((part) => { if (part instanceof T.Mesh) { part.castShadow = true; part.receiveShadow = true; } });
    return wrapper;
  }

  useWaystone(source: T.Object3D): void { this.waystone.clear(); this.waystone.add(this.fitted(source, 1.8)); }
  useLanterns(source: T.Object3D): void { this.lampSlots.forEach((slot) => { slot.clear(); slot.add(this.fitted(source, 0.6)); }); }

  useDetailedTrees(source: T.Object3D): void {
    for (const [x, z, height, rotation] of [[-10, 25, 11, 0.5], [11, 24, 12, 2], [-12, 13, 13, 1], [12, 10, 12, 3], [-14, -8, 11, 0], [14, -6, 12, 2.5]]) {
      const tree = this.fitted(source, height); tree.position.set(x, heightAt(x, z), z); tree.rotation.y = rotation; tree.userData.cameraThin = true; this.root.add(tree);
      this.solids.push({ x, z, radius: 0.8 });
    }
  }

  useForestDressing(fern: T.Object3D, rocks: T.Object3D): void {
    const parts: T.Mesh[] = [];
    rocks.updateWorldMatrix(true, true); rocks.traverse((part) => { if (part instanceof T.Mesh) parts.push(part); });
    const positions = [[-5, 16], [6, 12], [-7, 2], [5, -7], [-15, 6], [15, 18], [18, 28], [-14, 30]];
    positions.forEach(([x, z], i) => {
      const part = parts[i % parts.length], geometry = part.geometry.clone().applyMatrix4(part.matrixWorld); geometry.computeBoundingBox();
      const box = geometry.boundingBox!, center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()); geometry.translate(-center.x, -box.min.y, -center.z);
      const rock = new T.Mesh(geometry, part.material); rock.scale.setScalar((0.7 + i % 3 * 0.3) / size.y); rock.position.set(x, heightAt(x, z) - 0.05, z); rock.rotation.y = i * 1.7; rock.castShadow = true; rock.receiveShadow = true; this.root.add(rock);
      this.solids.push({ x, z, radius: Math.max(size.x, size.z) / 2 * rock.scale.x });
    });
    fern.updateWorldMatrix(true, true);
    fern.traverse((part) => {
      if (!(part instanceof T.Mesh)) return;
      const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld); geometry.computeBoundingBox(); const box = geometry.boundingBox!, center = box.getCenter(new T.Vector3()); geometry.translate(-center.x, -box.min.y, -center.z);
      const plants = new T.InstancedMesh(geometry, part.material, 90), transform = new T.Object3D();
      for (let i = 0; i < 90; i++) {
        const cluster = positions[i % positions.length], a = this.random() * Math.PI * 2, r = 1.2 + this.random() * 2;
        const x = cluster[0] + Math.cos(a) * r, z = cluster[1] + Math.sin(a) * r;
        transform.position.set(x, heightAt(x, z), z); transform.scale.setScalar(pathDistance(x, z) < 2.5 ? 0 : 0.45 + this.random() * 0.35); transform.rotation.y = this.random() * 6; transform.updateMatrix(); plants.setMatrixAt(i, transform.matrix);
      }
      plants.castShadow = true; plants.receiveShadow = true; this.root.add(plants);
    });
  }

  useTreeModel(source: T.Object3D): void {
    source.updateMatrixWorld(true);
    source.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const instances = new T.InstancedMesh(geometry, object.material, this.treeTransforms.length);
      this.treeTransforms.forEach((matrix, i) => instances.setMatrixAt(i, matrix));
      instances.castShadow = true; instances.receiveShadow = true; this.root.add(instances);
    });
    this.forestMeshes.forEach((object) => this.root.remove(object));
  }

  useGroundTextures(grass: T.Texture, stone: T.Texture, normal: T.Texture, grassNormal?: T.Texture): void {
    if (!this.ground) return;
    for (const texture of [grass, stone, normal, ...(grassNormal ? [grassNormal] : [])]) { texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(64, 64); texture.anisotropy = 8; }
    grass.colorSpace = stone.colorSpace = T.SRGBColorSpace;
    const mat = this.ground.material as T.MeshStandardMaterial;
    mat.map = grass; mat.normalMap = normal; mat.normalScale.set(0.35, 0.35);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.pathMap = { value: stone };
      shader.uniforms.grassNormalMap = { value: grassNormal ?? normal };
      shader.vertexShader = `attribute float pathWeight; varying float vPathWeight;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPathWeight = pathWeight;');
      shader.fragmentShader = `uniform sampler2D pathMap; uniform sampler2D grassNormalMap; varying float vPathWeight;\n${shader.fragmentShader}`.replace('#include <map_fragment>', '#ifdef USE_MAP\nvec4 groundColor = mix(texture2D(map, vMapUv), texture2D(pathMap, vMapUv), vPathWeight);\ndiffuseColor *= groundColor;\n#endif').replace('#include <normal_fragment_maps>', T.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = mix(texture2D(grassNormalMap, vNormalMapUv).xyz, texture2D(normalMap, vNormalMapUv).xyz, vPathWeight) * 2.0 - 1.0;'));
    };
    mat.needsUpdate = true;
  }

  private placeObjects(): void {
    // Reuse Dev 1's landmark catalog and lore, placing its props in the 3D regions.
    for (const env of ['forest', 'castle', 'cave'] as EnvironmentId[]) {
      for (const item of REGIONS[env].landmarks.filter((l) => l.kind === 'chest' || l.kind === 'shrine' || l.kind === 'lore')) {
        const center = CENTERS[env];
        const x = center.x + (item.x - 650) * 0.035, z = center.z + (item.y - 510) * 0.045;
        const root = new T.Group(); root.position.set(x, heightAt(x, z), z); this.root.add(root);
        const object: WorldObject = { x, z, root, id: `${env}:${item.id}`, name: item.name, detail: item.detail, kind: item.kind as WorldObject['kind'], used: false };
        if (item.kind === 'chest') {
          mesh(new T.BoxGeometry(1.15, 0.6, 0.7), material(0x89623e), root, 0, 0.35);
          const lid = new T.Group(); lid.position.set(0, 0.65, -0.35); root.add(lid); object.lid = lid;
          mesh(new T.BoxGeometry(1.2, 0.22, 0.74), material(0xa87d4c), lid, 0, 0.08, 0.35);
          for (const x of [-0.4, 0.4]) mesh(new T.BoxGeometry(0.08, 0.7, 0.76), gold, root, x, 0.4);
          mesh(new T.BoxGeometry(0.17, 0.19, 0.1), gold, root, 0, 0.55, 0.4);
        } else if (item.kind === 'shrine') {
          mesh(new T.CylinderGeometry(1.2, 1.4, 0.35, 12), stone, root, 0, 0.18);
          mesh(new T.CylinderGeometry(0.9, 0.6, 0.7, 12), pale, root, 0, 0.65);
          mesh(new T.CircleGeometry(0.82, 32), material(0x95dbcb, 0x60bda6), root, 0, 1.02).rotation.x = -Math.PI / 2;
          mesh(new T.OctahedronGeometry(0.2), material(0xbbf5dc, 0x83ddb9), root, 0, 1.65);
        } else {
          mesh(new T.ConeGeometry(0.65, 1.7, 8), material(0xa5d9c3, 0x325a49), root, 0, 0.9);
          mesh(new T.SphereGeometry(0.25, 10, 8), material(0xf5dfb3), root, 0, 1.9);
          mesh(new T.ConeGeometry(0.5, 0.8, 8), material(0xa5c2ac), root, 0, 2.45);
          for (const side of [-1, 1]) mesh(new T.SphereGeometry(0.12, 8, 6), material(0xf5dfb3), root, side * 0.55, 1.2, 0.15);
        }
        this.objects.push(object);
      }
    }
  }

  setObjective(p: Position): void { this.marker.position.set(p.x, heightAt(p.x, p.z), p.z); this.marker.visible = true; }

  collisionSurfaces(): T.Mesh[] {
    const surfaces: T.Mesh[] = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((object) => {
      if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh) return;
      let parent: T.Object3D | null = object;
      while (parent) { if (parent === this.marker || parent.userData.physics === false) return; parent = parent.parent; }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.every((mat) => mat instanceof T.MeshBasicMaterial || /old-magic|ivy|living-moss|foliage|leaves|fern/.test(mat.name))) return;
      if (object !== this.ground && ['CircleGeometry', 'TorusGeometry', 'PlaneGeometry'].includes(object.geometry.type)) return;
      surfaces.push(object);
    });
    return surfaces;
  }

  update(dt: number, time: number): void {
    this.markerGem.position.y = 3.1 + Math.sin(time * 2.2) * 0.2; this.markerGem.rotation.y += dt * 0.7;
    this.water.position.y = -0.08 + Math.sin(time * 0.6) * 0.025;
    this.wind.value = time; this.waterMaterial.uniforms.time.value = time;
    const motes = this.particles.geometry.getAttribute('position') as T.BufferAttribute, base = this.moteBase;
    for (let i = 0; i < motes.count; i++) {
      const j = i * 3; motes.setXYZ(i, base[j] + Math.sin(time * 0.31 + i) * 1.3, base[j + 1] + Math.sin(time * 0.53 + i * 1.7) * 0.6, base[j + 2] + Math.cos(time * 0.27 + i * 0.9) * 1.3);
    }
    motes.needsUpdate = true;
    (this.particles.material as T.PointsMaterial).opacity = 0.75 + Math.sin(time * 1.3) * 0.15;
    this.shafts.forEach((mat, i) => { mat.opacity = 0.09 + Math.sin(time * 0.35 + i * 1.9) * 0.04; });
    this.flags.forEach((flag) => { const p = flag.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3 + time * 3) * 0.14); p.needsUpdate = true; });
    this.lights.forEach((light) => { light.rotation.z = time * 0.12; });
    this.shards.forEach((shard, i) => { if (!shard.taken) { shard.mesh.rotation.y += dt; shard.mesh.position.y = shard.baseY + Math.sin(time * 2 + i) * 0.13; } });
    this.objects.forEach((object) => { if (object.lid && object.used) object.lid.rotation.x += (-1.9 - object.lid.rotation.x) * Math.min(1, dt * 5); });
  }
}
