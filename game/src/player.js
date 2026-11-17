// player.js — Danny "D" Marlow on foot: third-person movement, jumping, punching,
// entering and exiting cars. V2: the new human-proportioned figure — the walk
// cycle bends knees and elbows, the torso leans into a run, the head bobs.
// Written for Solmar Bay: Street Heat (make.fun gta6-01).

import * as THREE from 'three';
import { angleLerp, clamp, dist2d, pushOutOfBox } from './utils.js';
import { applyWalkCycle, makePersonMesh } from './pedestrians.js';

export class Player {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.x = -178;
    this.z = -168;
    this.heading = Math.PI; // facing south down the street
    this.speed = 0;
    this.health = 100;
    this.vy = 0;
    this.y = 0;
    this.onFoot = true;
    this.car = null; // car state when driving
    this.walkPhase = 0;
    this.punchTimer = 0;
    this.punchCooldown = 0;
    this.hurtFlash = 0;
    // Danny: teal jacket over a white tee, dark jeans, short brown hair.
    const mesh = makePersonMesh({
      shirt: 0xf0f0f0,
      jacket: 0x1a8a8a,
      pants: 0x2a2a30,
      skin: 0xe8b890,
      hair: 'short',
      hairColor: 0x4a2a18,
    });
    this.mesh = mesh;
    this.mesh.group.position.set(this.x, 0, this.z);
    scene.add(this.mesh.group);
  }

  get pos() {
    return { x: this.x, z: this.z };
  }

  // Move on foot. moveX/moveZ are in camera-relative space.
  updateOnFoot(dt, input, camYaw) {
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    const fwd = input.axis('KeyW', 'KeyS') || input.axis('ArrowUp', 'ArrowDown');
    const strafe = input.axis('KeyD', 'KeyA') || input.axis('ArrowRight', 'ArrowLeft');
    // Camera-relative movement (forward is -Z rotated by camYaw).
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    let mx = -sin * fwd - cos * strafe;
    let mz = -cos * fwd + sin * strafe;
    const len = Math.hypot(mx, mz);
    const targetSpeed = len > 0.01 ? (run ? 9 : 5) : 0;
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      const targetHeading = Math.atan2(-mx, -mz);
      this.heading = angleLerp(this.heading, targetHeading, Math.min(1, dt * 12));
    }
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 10);
    const nx = this.x + -Math.sin(this.heading) * this.speed * dt * (len > 0.01 ? 1 : 0);
    const nz = this.z + -Math.cos(this.heading) * this.speed * dt * (len > 0.01 ? 1 : 0);
    this.x = nx;
    this.z = nz;
    // Jump.
    if (input.hit('Space') && this.y === 0) this.vy = 7.5;
    if (this.y > 0 || this.vy !== 0) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }
    // Building collisions.
    for (const box of this.city.colliders) {
      if (this.x < box.x0 - 0.7 || this.x > box.x1 + 0.7 || this.z < box.z0 - 0.7 || this.z > box.z1 + 0.7) continue;
      const out = pushOutOfBox(this.x, this.z, 0.7, box);
      if (out) {
        this.x = out.x;
        this.z = out.z;
      }
    }
    const c = this.city.clampToCity(this.x, this.z);
    this.x = c.x;
    this.z = c.z;
    // Walk/run animation: knees and elbows bend, torso leans into a run,
    // the whole figure bobs a little with each step.
    this.walkPhase += dt * this.speed * 1.6;
    const amount = clamp(this.speed / 5, 0, 1.4);
    applyWalkCycle(this.mesh, this.walkPhase, amount);
    this.mesh.torso.rotation.x = amount * 0.12; // lean forward when running
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.045 * amount;
    // Punch animation: right arm swings forward, elbow straightens.
    if (this.punchTimer > 0) {
      this.punchTimer -= dt;
      const p = Math.sin((this.punchTimer / 0.25) * Math.PI);
      this.mesh.armR.rotation.x = -1.6 * p;
      this.mesh.foreR.rotation.x = -0.1 * p;
    }
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this.mesh.group.position.set(this.x, this.y + bob, this.z);
    this.mesh.group.rotation.y = this.heading;
  }

  tryPunch() {
    if (this.punchCooldown > 0 || !this.onFoot) return false;
    this.punchCooldown = 0.45;
    this.punchTimer = 0.25;
    return true;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = 0.25;
    return this.health <= 0;
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount);
  }

  enterCar(carState) {
    this.onFoot = false;
    this.car = carState;
    this.mesh.group.visible = false;
  }

  exitCar() {
    if (!this.car) return;
    const side = 2.4;
    const sx = this.car.x + Math.cos(this.car.heading) * side;
    const sz = this.car.z - Math.sin(this.car.heading) * side;
    this.x = sx;
    this.z = sz;
    this.heading = this.car.heading;
    this.onFoot = true;
    this.car = null;
    this.mesh.group.visible = true;
    this.mesh.group.position.set(this.x, 0, this.z);
  }

  teleport(x, z, heading = 0) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    if (this.car) {
      this.car.x = x;
      this.car.z = z;
      this.car.heading = heading;
      this.car.speed = 0;
    }
    this.mesh.group.position.set(x, this.y, z);
  }

  // Where the camera should look: the player, or the car when driving.
  focusPoint() {
    if (this.car) return { x: this.car.x, z: this.car.z, heading: this.car.heading, speed: this.car.speed };
    return { x: this.x, z: this.z, heading: this.heading, speed: this.speed };
  }
}
