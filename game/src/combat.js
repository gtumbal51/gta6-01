// combat.js — fist fighting and the pistol, plus the Viper street crew that
// guards the cash drops in mission 3. V2: thugs wear a red bandana and a dark
// vest, hits throw a burst of impact sparks and make the thug stagger, and
// every shot shows a muzzle flash. Written for Solmar Bay: Street Heat.

import * as THREE from 'three';
import { angleDiff, clamp, dist2d, rand } from './utils.js';
import { applyWalkCycle, makePersonMesh } from './pedestrians.js';

export class CombatSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.thugs = []; // {mesh, x, z, heading, health, attackTimer, walkPhase, state}
    this.tracers = []; // fading shot lines {mesh, life}
    this.bursts = []; // impact spark particles {mesh, vel, life}
    this.muzzle = null;
    this.muzzleLife = 0;
  }

  spawnThugs(n, cx, cz) {
    const spawned = [];
    for (let i = 0; i < n; i++) {
      const x = cx + rand(this.rng, -6, 6);
      const z = cz + rand(this.rng, -6, 6);
      // Viper crew: red bandana, dark vest over a black tee, jeans.
      const mesh = makePersonMesh({
        shirt: 0x222228,
        jacket: 0x8a1a2a,
        pants: 0x2a2a30,
        skin: 0xc89068,
        hair: 'bandana',
        hairColor: 0x8a1a1a,
      });
      mesh.group.position.set(x, 0, z);
      this.scene.add(mesh.group);
      const thug = {
        mesh,
        x,
        z,
        heading: rand(this.rng, 0, Math.PI * 2),
        health: 100,
        attackTimer: 0,
        walkPhase: this.rng() * 6,
        state: 'guard',
        stagger: 0,
      };
      this.thugs.push(thug);
      spawned.push(thug);
    }
    return spawned;
  }

  clearThugs() {
    for (const t of this.thugs) this.scene.remove(t.mesh.group);
    this.thugs = [];
    for (const b of this.bursts) this.scene.remove(b.mesh);
    this.bursts = [];
    if (this.muzzle) {
      this.scene.remove(this.muzzle);
      this.muzzle = null;
    }
  }

  // A punch from the player: hits thugs and cops in front, within 2.2 units.
  punch(fromX, fromZ, heading) {
    let hitAny = false;
    for (const t of this.thugs) {
      const d = dist2d(fromX, fromZ, t.x, t.z);
      if (d > 2.4) continue;
      const ang = Math.abs(angleDiff(heading, Math.atan2(-(t.x - fromX), -(t.z - fromZ))));
      if (ang > 1.1) continue;
      this._damageThug(t, 34, fromX, fromZ);
      hitAny = true;
    }
    return hitAny;
  }

  // A pistol shot from (fromX, fromZ) along heading. Returns what was hit.
  shoot(fromX, fromZ, heading, ammo) {
    if (ammo <= 0) return { fired: false, hit: null };
    const range = 42;
    const dirX = -Math.sin(heading);
    const dirZ = -Math.cos(heading);
    let best = null;
    let bd = range;
    for (const t of this.thugs) {
      const dx = t.x - fromX;
      const dz = t.z - fromZ;
      const along = dx * dirX + dz * dirZ;
      if (along < 0 || along > range) continue;
      const perp = Math.abs(dx * dirZ - dz * dirX);
      if (perp > 1.4) continue;
      if (along < bd) {
        bd = along;
        best = { kind: 'thug', target: t, dist: along };
      }
    }
    if (best) this._damageThug(best.target, 50, fromX, fromZ);
    // Muzzle flash at the gun, tracer line to the hit (or full range).
    this._muzzleFlash(fromX + dirX * 0.9, 1.45, fromZ + dirZ * 0.9, heading);
    const endX = fromX + dirX * (best ? bd : range);
    const endZ = fromZ + dirZ * (best ? bd : range);
    this._addTracer(fromX, 1.5, fromZ, endX, 1.5, endZ);
    return { fired: true, hit: best ? best.kind : null };
  }

  _damageThug(t, amount, fromX, fromZ) {
    t.health -= amount;
    const d = Math.max(dist2d(t.x, t.z, fromX, fromZ), 0.01);
    t.x += ((t.x - fromX) / d) * 1.2;
    t.z += ((t.z - fromZ) / d) * 1.2;
    t.state = 'chase';
    t.stagger = 0.35; // brief wobble: the thug reels from the hit
    this._impactBurst(t.x, 1.3, t.z);
    if (t.health <= 0) {
      t.state = 'down';
      t.mesh.group.rotation.x = -Math.PI / 2;
      t.mesh.group.position.y = 0.4;
    }
  }

  // A short-lived starburst of yellow sparks at a hit point.
  _impactBurst(x, y, z) {
    const geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe94a, transparent: true, opacity: 0.95 });
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      const a = (i / 8) * Math.PI * 2 + this.rng() * 0.6;
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.bursts.push({
        mesh,
        vel: { x: Math.cos(a) * (2 + this.rng() * 3), y: 1 + this.rng() * 2.5, z: Math.sin(a) * (2 + this.rng() * 3) },
        life: 0.3,
      });
    }
  }

  // A bright quad at the muzzle, facing the camera, gone in 60 ms.
  _muzzleFlash(x, y, z, heading) {
    if (this.muzzle) this.scene.remove(this.muzzle);
    const geo = new THREE.PlaneGeometry(0.7, 0.7);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.muzzle = new THREE.Mesh(geo, mat);
    this.muzzle.position.set(x, y, z);
    this.muzzle.rotation.y = heading;
    this.scene.add(this.muzzle);
    this.muzzleLife = 0.06;
  }

  _addTracer(x0, y0, z0, x1, y1, z1) {
    const len = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
    const geo = new THREE.BoxGeometry(0.06, 0.06, len);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.lookAt(x1, y1, z1);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.12 });
  }

  update(dt, player) {
    // Fade tracers.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.12) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    // Fly out and fade impact sparks.
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      b.vel.y -= 9 * dt;
      b.mesh.position.x += b.vel.x * dt;
      b.mesh.position.y += b.vel.y * dt;
      b.mesh.position.z += b.vel.z * dt;
      b.mesh.material.opacity = Math.max(0, b.life / 0.3) * 0.95;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bursts.splice(i, 1);
      }
    }
    // Muzzle flash expires fast.
    if (this.muzzle) {
      this.muzzleLife -= dt;
      if (this.muzzleLife <= 0) {
        this.scene.remove(this.muzzle);
        this.muzzle = null;
      }
    }
    // Thugs chase and punch the player when close (the car when driving).
    const fp = player.focusPoint();
    for (const t of this.thugs) {
      if (t.state === 'down') continue;
      const d = dist2d(t.x, t.z, fp.x, fp.z);
      if (t.state === 'guard' && d < 16) t.state = 'chase';
      if (t.state !== 'chase') continue;
      const targetHeading = Math.atan2(-(fp.x - t.x), -(fp.z - t.z));
      const diff = angleDiff(t.heading, targetHeading);
      t.heading += clamp(diff, -3.2 * dt, 3.2 * dt);
      const sp = d > 2 ? 5.2 : 0;
      t.x += -Math.sin(t.heading) * sp * dt;
      t.z += -Math.cos(t.heading) * sp * dt;
      t.walkPhase += dt * 9;
      applyWalkCycle(t.mesh, t.walkPhase, 0.9);
      // Stagger: the torso rocks back briefly after a hit.
      if (t.stagger > 0) {
        t.stagger -= dt;
        t.mesh.torso.rotation.x = Math.sin((t.stagger / 0.35) * Math.PI) * -0.35;
      } else {
        t.mesh.torso.rotation.x = 0;
      }
      t.mesh.group.position.set(t.x, 0, t.z);
      t.mesh.group.rotation.y = t.heading;
      t.attackTimer -= dt;
      if (d < 2 && t.attackTimer <= 0) {
        t.attackTimer = 1.1;
        t.mesh.armR.rotation.x = -1.6;
        if (player.takeDamage(12)) return 'wasted';
      }
    }
    return null;
  }

  aliveThugs() {
    return this.thugs.filter((t) => t.state !== 'down');
  }
}
