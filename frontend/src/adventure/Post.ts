import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Rishaan's art direction as a final grade: warm golden light, emerald greens, soft bloom on magic,
 * a storybook vignette. Also carries gameplay feedback: blue slow-motion tint and red damage pulse.
 */
const Grade = {
  uniforms: { tDiffuse: { value: null }, flurry: { value: 0 }, hurt: { value: 0 }, time: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float flurry; uniform float hurt; uniform float time; uniform float aspect; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Warm the highlights, keep shadows a touch green-blue: golden-hour storybook.
      c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.35, 0.95, l));
      c = mix(c, c * vec3(0.94, 1.02, 1.04), 1.0 - smoothstep(0.05, 0.4, l));
      c = mix(vec3(l), c, 1.12);                      // gentle saturation
      c = (c - 0.5) * 1.04 + 0.5;                     // gentle contrast
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float vig = smoothstep(1.05, 0.35, length(p));
      c *= mix(0.72, 1.0, vig);
      // Flurry rush: cool, desaturated, edges darker.
      c = mix(c, vec3(l) * vec3(0.72, 0.9, 1.15) + vec3(0.0, 0.02, 0.06), flurry * 0.55);
      c *= mix(1.0, mix(0.55, 1.0, vig), flurry);
      // Damage: a red pulse from the edges inward.
      c = mix(c, vec3(0.75, 0.05, 0.04), hurt * (1.0 - vig) * 0.75);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  private readonly grade: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  flurry = 0;
  hurt = 0;

  constructor(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera) {
    const size = renderer.getSize(new T.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new T.Vector2(size.x, size.y), 0.42, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(Grade); this.composer.addPass(this.grade);
    this.resize();
  }
  resize(): void {
    this.composer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); this.composer.setSize(innerWidth, innerHeight);
    this.grade.uniforms.aspect.value = innerWidth / innerHeight;
  }
  render(dt: number, time: number): void {
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.grade.uniforms.flurry.value = this.flurry; this.grade.uniforms.hurt.value = this.hurt; this.grade.uniforms.time.value = time;
    this.bloom.strength = 0.42 + this.flurry * 0.3;
    this.composer.render(dt);
  }
}

/** Uniforms shared by every faded world material, updated once per frame. */
export const occlusion = { uCamPos: { value: new T.Vector3() }, uFocus: { value: new T.Vector3() } };

/**
 * See-through scenery: fragments right in front of the lens, or on the line from the camera to the hero,
 * dissolve with an ordered dither (no sorting problems), the way modern action-adventures keep the hero visible.
 */
export function fadeOccluders(root: T.Object3D, skip: (o: T.Object3D) => boolean): void {
  const done = new WeakSet<T.Material>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || skip(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (done.has(mat) || !(mat instanceof T.MeshStandardMaterial) || mat.onBeforeCompile.toString() !== T.Material.prototype.onBeforeCompile.toString()) continue;
      done.add(mat);
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, occlusion);
        shader.vertexShader = 'varying vec3 vRiftWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
          vec4 riftW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            riftW = instanceMatrix * riftW;
          #endif
          vRiftWorld = (modelMatrix * riftW).xyz;`);
        shader.fragmentShader = 'varying vec3 vRiftWorld; uniform vec3 uCamPos; uniform vec3 uFocus;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          {
            float near = smoothstep(1.0, 3.4, distance(vRiftWorld, uCamPos));
            vec3 seg = uFocus - uCamPos; float len2 = max(dot(seg, seg), 0.0001);
            float t = clamp(dot(vRiftWorld - uCamPos, seg) / len2, 0.0, 1.0);
            float side = distance(vRiftWorld, uCamPos + seg * t);
            float sight = (t > 0.04 && t < 0.9) ? smoothstep(0.45, 1.25, side) : 1.0;
            float keep = min(near, sight);
            if (keep < 0.999) {
              const float bayer4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
              ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
              if (keep < (bayer4[q.y * 4 + q.x] + 0.5) / 16.0) discard;
            }
          }`);
      };
      mat.needsUpdate = true;
    }
  });
}
