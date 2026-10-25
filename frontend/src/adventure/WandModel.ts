import * as T from 'three';
import { ARCANE_COLOR } from './weapon';

/**
 * The wand in each hero's off hand (the sword is in the other). Built along +Y with the origin at the grip, about a
 * third up from the butt, so `Actor.holdWand` only has to place and turn it. The crystal glows in the held relic's
 * element colour (arcane violet without one) and flares on every cast.
 */
export class WandModel {
  readonly root = new T.Group();
  private readonly tip: T.MeshStandardMaterial;
  private readonly halo: T.MeshBasicMaterial;
  private readonly haloMesh: T.Mesh;
  private flare = 0;

  constructor(length = 0.42) {
    this.root.name = 'wand';
    const wood = new T.MeshStandardMaterial({ color: 0x5a3b24, roughness: 0.7, metalness: 0.05 });
    const shaft = new T.Mesh(new T.CylinderGeometry(0.009, 0.016, length, 8), wood);
    shaft.position.y = length * 0.5 - length * 0.32;
    const band = new T.Mesh(new T.TorusGeometry(0.016, 0.004, 6, 12), new T.MeshStandardMaterial({ color: 0xd8b56a, roughness: 0.35, metalness: 0.8 }));
    band.rotation.x = Math.PI / 2; band.position.y = length * 0.68 - length * 0.32;
    this.tip = new T.MeshStandardMaterial({ color: 0xffffff, emissive: ARCANE_COLOR, emissiveIntensity: 1.4, roughness: 0.2 });
    const crystal = new T.Mesh(new T.OctahedronGeometry(0.024, 0), this.tip);
    crystal.position.y = length - length * 0.32 + 0.012; crystal.scale.set(1, 1.6, 1);
    this.halo = new T.MeshBasicMaterial({ color: ARCANE_COLOR, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false });
    this.haloMesh = new T.Mesh(new T.SphereGeometry(0.05, 10, 8), this.halo); this.haloMesh.position.copy(crystal.position);
    [shaft, band, crystal].forEach((part) => { part.castShadow = true; });
    this.root.add(shaft, band, crystal, this.haloMesh);
  }

  setColor(color: number): void { this.tip.emissive.set(color); this.halo.color.set(color); }

  /** A bright flare that fades over about a third of a second. */
  flash(): void { this.flare = 1; }

  update(dt: number): void {
    if (this.flare <= 0) return;
    this.flare = Math.max(0, this.flare - dt * 3);
    this.tip.emissiveIntensity = 1.4 + this.flare * 4; this.halo.opacity = 0.35 + this.flare * 0.6; this.haloMesh.scale.setScalar(1 + this.flare * 2.2);
  }

  dispose(): void { this.root.traverse((part) => { if (part instanceof T.Mesh) { part.geometry.dispose(); (part.material as T.Material).dispose(); } }); this.root.removeFromParent(); }
}
