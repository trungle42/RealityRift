import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import type { Solid } from './terrain';

let ready: Promise<void> | undefined;
interface Pawn { body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController; grounded: boolean; offset: number; radius: number; halfHeight: number; crouched: boolean }

/** Actual scene geometry is the source of static collision, including arch openings. */
export class Physics {
  readonly world: RAPIER.World;
  private readonly pawns: (Pawn | undefined)[] = [];
  private readonly surfaces: { mesh: T.Mesh; collider: RAPIER.Collider; matrix: T.Matrix4 }[] = [];

  static async create(surfaces: T.Mesh[], trees: (Solid & { y: number })[]): Promise<Physics> {
    ready ??= RAPIER.init(); await ready;
    return new Physics(surfaces, trees);
  }

  private constructor(surfaces: T.Mesh[], trees: (Solid & { y: number })[]) {
    this.world = new RAPIER.World({ x: 0, y: -19, z: 0 });
    for (const surface of surfaces) {
      surface.updateWorldMatrix(true, false);
      const geometry = surface.geometry.clone().applyMatrix4(surface.matrixWorld);
      const positions = geometry.getAttribute('position');
      const vertices = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) { vertices[i * 3] = positions.getX(i); vertices[i * 3 + 1] = positions.getY(i); vertices[i * 3 + 2] = positions.getZ(i); }
      const index = geometry.getIndex(), indices = index ? Uint32Array.from(index.array) : Uint32Array.from({ length: positions.count }, (_, i) => i);
      if (indices.length >= 3) {
        const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.8));
        this.surfaces.push({ mesh: surface, collider, matrix: surface.matrixWorld.clone() });
      }
      geometry.dispose();
    }
    for (const tree of trees) this.world.createCollider(RAPIER.ColliderDesc.cylinder(2.5, tree.radius).setTranslation(tree.x, tree.y + 2.5, tree.z));
    // Shallow wading support under the lake; bank geometry handles entering/exiting.
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.04, 16.8).setTranslation(30, -0.62, 24));
    for (const x of [-67.5, 67.5]) this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 40, 65).setTranslation(x, 15, -5));
    for (const z of [-69.5, 58.5]) this.world.createCollider(RAPIER.ColliderDesc.cuboid(68, 40, 0.5).setTranslation(0, 15, z));
    this.world.step();
  }

  addCharacter(feet: T.Vector3, radius = 0.32, halfHeight = 0.55): number {
    const offset = radius + halfHeight + 0.02;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + offset, feet.z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0), body);
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.32, 0.16, false); controller.enableSnapToGround(0.25);
    controller.setMaxSlopeClimbAngle(Math.PI / 4); controller.setMinSlopeSlideAngle(Math.PI / 3);
    this.pawns.push({ body, collider, controller, grounded: false, offset, radius, halfHeight, crouched: false }); this.world.step();
    return this.pawns.length - 1;
  }

  move(index: number, feet: T.Vector3, delta: T.Vector3): T.Vector3 {
    const pawn = this.pawns[index]; if (!pawn) return feet.clone();
    const current = pawn.body.translation(), offset = pawn.offset;
    // Explicit scene relocation is used only by setup / development scenarios.
    if (Math.hypot(current.x - feet.x, current.y - feet.y - offset, current.z - feet.z) > 0.15) {
      pawn.body.setTranslation({ x: feet.x, y: feet.y + offset, z: feet.z }, true);
      pawn.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + offset, z: feet.z });
      this.world.step();
    }
    pawn.controller.computeColliderMovement(pawn.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const corrected = pawn.controller.computedMovement(), at = pawn.body.translation();
    const next = new T.Vector3(at.x + corrected.x, at.y + corrected.y - offset, at.z + corrected.z);
    pawn.body.setNextKinematicTranslation({ x: next.x, y: next.y + offset, z: next.z });
    pawn.grounded = pawn.controller.computedGrounded();
    // Commit before the next character query so opposing dodges cannot overlap.
    this.world.step();
    return next;
  }

  isGrounded(index: number): boolean { return this.pawns[index]?.grounded ?? false; }
  setCrouching(index: number, wanted: boolean): boolean {
    const pawn = this.pawns[index]; if (!pawn || pawn.crouched === wanted) return pawn?.crouched ?? false;
    const at = pawn.body.translation(), feet = at.y - pawn.offset;
    const height = wanted ? pawn.halfHeight * 0.45 : pawn.halfHeight, offset = pawn.radius + height + 0.02;
    const next = { x: at.x, y: feet + offset, z: at.z }, shape = new RAPIER.Capsule(height, pawn.radius);
    if (!wanted && this.world.intersectionWithShape(next, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, pawn.collider, pawn.body)) return true;
    pawn.collider.setShape(shape); pawn.body.setTranslation(next, true); pawn.body.setNextKinematicTranslation(next); pawn.offset = offset; pawn.crouched = wanted;
    this.world.propagateModifiedBodyPositionsToColliders();
    return wanted;
  }
  removeCharacter(index: number): void { const pawn = this.pawns[index]; if (pawn) { this.world.removeCharacterController(pawn.controller); this.world.removeRigidBody(pawn.body); this.pawns[index] = undefined; } }
  step(dt: number): void {
    for (const surface of this.surfaces) {
      let visible = true, parent: T.Object3D | null = surface.mesh;
      while (parent) { if (!parent.visible) visible = false; parent = parent.parent; }
      surface.collider.setEnabled(visible);
      if (!visible) continue;
      surface.mesh.updateWorldMatrix(true, false);
      if (surface.matrix.equals(surface.mesh.matrixWorld)) continue;
      const geometry = surface.mesh.geometry.clone().applyMatrix4(surface.mesh.matrixWorld), position = geometry.getAttribute('position');
      const vertices = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) { vertices[i * 3] = position.getX(i); vertices[i * 3 + 1] = position.getY(i); vertices[i * 3 + 2] = position.getZ(i); }
      const index = geometry.getIndex(), indices = index ? Uint32Array.from(index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
      surface.collider.setShape(new RAPIER.TriMesh(vertices, indices)); surface.matrix.copy(surface.mesh.matrixWorld); geometry.dispose();
    }
    this.world.timestep = Math.max(0.001, Math.min(dt, 0.045)); this.world.step();
  }

  /** Static scenery blocks sight, the camera and projectiles; heroes are excluded. */
  wallDistance(from: T.Vector3, to: T.Vector3): number | undefined {
    const direction = to.clone().sub(from), length = direction.length();
    if (length < 0.001) return undefined;
    direction.divideScalar(length);
    const hit = this.world.castRay(new RAPIER.Ray(from, direction), length, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    return hit?.timeOfImpact;
  }

  dispose(): void { this.world.free(); }
}
