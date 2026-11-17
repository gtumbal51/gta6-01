// police.js — the wanted system: stars 0-5, police cruisers that chase and ram,
// foot cops that close in, busted when they catch Danny, heat that cools off.
// V2: foot cops wear a proper uniform — peaked cap, navy jacket, gold badge —
// and walk with the same knee-and-elbow gait as everyone else.
// Written for Solmar Bay: Street Heat (make.fun gta6-01).

import * as THREE from 'three';
import { angleLerp, clamp, dist2d } from './utils.js';
import { createCarState, makeCarMesh, stepCar } from './vehicles.js';
import { applyWalkCycle, makePersonMesh } from './pedestrians.js';

export class PoliceSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.wanted = 0;
    this.heat = 0; // seconds since the last crime; cools the wanted level
    this.cooldown = 0;
    this.cruisers = []; // car states with meshes
    this.cops = []; // foot cops {mesh, x, z, heading, grabTimer}
    this.bustedTimer = 0;
    this.flashTimer = 0;
    this.spawnTimer = 0;
  }

  addWanted(n, reason) {
    if (this.wanted >= 5) return;
    this.wanted = clamp(this.wanted + n, 0, 5);
    this.heat = 0;
    if (reason) this.lastReason = reason;
  }

  clearWanted() {
    this.wanted = 0;
    this.heat = 0;
    this._despawnAll();
  }

  _despawnAll() {
    for (const c of this.cruisers) this.scene.remove(c.mesh.group);
    this.cruisers = [];
    for (const c of this.cops) this.scene.remove(c.mesh.group);
    this.cops = [];
  }

  _spawnCruiser(px, pz) {
    const spot = this.city.randomRoadPoint(this.rng, px, pz, 55, 110);
    const state = createCarState(spot.x, spot.z, 0, {
      maxSpeed: 33 + this.wanted * 1.5,
      accel: 20,
      health: 100,
      color: 0x222226,
      police: true,
    });
    state.mesh = makeCarMesh(0x222226, { police: true });
    state.mesh.group.position.set(spot.x, 0, spot.z);
    this.scene.add(state.mesh.group);
    this.cruisers.push(state);
  }

  _spawnCop(px, pz) {
    const spot = this.city.randomRoadPoint(this.rng, px, pz, 25, 45);
    // Navy uniform, peaked cap, gold badge on the chest.
    const mesh = makePersonMesh({
      shirt: 0xd8d8d8,
      jacket: 0x1a2a4a,
      pants: 0x1a1a22,
      skin: 0xe8b890,
      hair: 'cap',
      hairColor: 0x101828,
    });
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.09, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.8, roughness: 0.3 }),
    );
    badge.position.set(-0.1, 1.28, -0.145);
    mesh.group.add(badge);
    mesh.group.position.set(spot.x, 0, spot.z);
    this.scene.add(mesh.group);
    this.cops.push({ mesh, x: spot.x, z: spot.z, heading: 0, grabTimer: 0, walkPhase: 0 });
  }

  update(dt, player, audio, onBusted) {
    // Chase the focus point: the car when Danny is driving, Danny on foot.
    const fp = player.focusPoint();
    const px = fp.x;
    const pz = fp.z;
    this.flashTimer += dt;
    // Siren audio follows the wanted level.
    if (audio) audio.setSiren(this.wanted > 0, dt);
    // Heat decay: no crime for a while and the stars drop one at a time.
    if (this.wanted > 0) {
      this.heat += dt;
      const coolTime = 26 - this.wanted * 2; // higher wanted cools slower
      if (this.heat > coolTime) {
        this.wanted -= 1;
        this.heat = 0;
        if (this.wanted === 0) this._despawnAll();
      }
    }
    // Spawn cruisers up to the wanted level (max 4 on screen).
    const wantCruisers = this.wanted === 0 ? 0 : Math.min(4, this.wanted + (player.onFoot ? 0 : 1));
    this.spawnTimer -= dt;
    if (this.cruisers.length < wantCruisers && this.spawnTimer <= 0) {
      this._spawnCruiser(px, pz);
      this.spawnTimer = 1.2;
    }
    while (this.cruisers.length > wantCruisers) {
      const c = this.cruisers.pop();
      this.scene.remove(c.mesh.group);
    }
    // Foot cops when wanted >= 2 and Danny is on foot.
    const wantCops = this.wanted >= 2 && player.onFoot ? Math.min(2, this.wanted - 1) : 0;
    if (this.cops.length < wantCops && this.spawnTimer <= 0) {
      this._spawnCop(px, pz);
      this.spawnTimer = 1.5;
    }
    while (this.cops.length > wantCops) {
      const c = this.cops.pop();
      this.scene.remove(c.mesh.group);
    }
    // Chase: cruisers steer toward the player and ram.
    for (const cruiser of this.cruisers) {
      const d = dist2d(cruiser.x, cruiser.z, px, pz);
      // Stuck against a building? Give up and re-enter the chase from a road
      // near the player instead of grinding against a wall forever.
      if (Math.abs(cruiser.speed) < 3 && d > 18) {
        cruiser.stuckTimer = (cruiser.stuckTimer || 0) + dt;
        if (cruiser.stuckTimer > 2.5) {
          const spot = this.city.randomRoadPoint(this.rng, px, pz, 45, 90);
          cruiser.x = spot.x;
          cruiser.z = spot.z;
          cruiser.speed = 10;
          cruiser.stuckTimer = 0;
          continue;
        }
      } else {
        cruiser.stuckTimer = 0;
      }
      const targetHeading = Math.atan2(-(px - cruiser.x), -(pz - cruiser.z));
      const steer = clamp(((targetHeading - cruiser.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1, 1);
      const throttle = d > 6 ? 1 : 0.4;
      stepCar(cruiser, { throttle, steer, handbrake: false }, dt, this.city, (s) => {
        if (audio) audio.crash(Math.min(1, s / 20));
      });
      // Flash the light bar.
      if (cruiser.mesh.lightBar) {
        const phase = Math.floor(this.flashTimer * 6) % 2 === 0;
        cruiser.mesh.lightBar.userData.red.material.emissiveIntensity = phase ? 2.2 : 0.2;
        cruiser.mesh.lightBar.userData.blue.material.emissiveIntensity = phase ? 0.2 : 2.2;
      }
      // Ram the player's car.
      if (!player.onFoot && player.car) {
        const cd = dist2d(cruiser.x, cruiser.z, player.car.x, player.car.z);
        if (cd < 3.4) {
          const push = (3.4 - cd) / 3.4;
          const nx = (player.car.x - cruiser.x) / Math.max(cd, 0.01);
          const nz = (player.car.z - cruiser.z) / Math.max(cd, 0.01);
          player.car.x += nx * push * 1.6;
          player.car.z += nz * push * 1.6;
          player.car.health -= 14 * dt * 8;
          cruiser.speed *= 0.85;
          if (audio) audio.crash(0.5);
          if (player.car.health <= 0) {
            onBusted('Your car was wrecked by the Solmar Bay PD.');
            return;
          }
        }
      }
      // Ram Danny on foot.
      if (player.onFoot && d < 2.2) {
        if (player.takeDamage(26 * dt * 4)) {
          onBusted('Run over by a police cruiser.');
          return;
        }
        player.x += (px - cruiser.x) / Math.max(d, 0.01) * 2 * dt * 8;
        player.z += (pz - cruiser.z) / Math.max(d, 0.01) * 2 * dt * 8;
      }
    }
    // Foot cops close in and grab.
    for (const cop of this.cops) {
      const d = dist2d(cop.x, cop.z, px, pz);
      const targetHeading = Math.atan2(-(px - cop.x), -(pz - cop.z));
      cop.heading = angleLerp(cop.heading, targetHeading, Math.min(1, dt * 6));
      const sp = d > 3 ? 6.2 : 2.5;
      cop.x += -Math.sin(cop.heading) * sp * dt;
      cop.z += -Math.cos(cop.heading) * sp * dt;
      cop.walkPhase += dt * 9;
      applyWalkCycle(cop.mesh, cop.walkPhase, 0.9);
      cop.mesh.group.position.set(cop.x, 0, cop.z);
      cop.mesh.group.rotation.y = cop.heading;
      if (d < 1.8) {
        cop.grabTimer += dt;
        if (cop.grabTimer > 1.6) {
          onBusted('Caught by the Solmar Bay PD.');
          return;
        }
      } else {
        cop.grabTimer = Math.max(0, cop.grabTimer - dt);
      }
    }
  }

  // For the minimap.
  positions() {
    return {
      cruisers: this.cruisers.map((c) => ({ x: c.x, z: c.z })),
      cops: this.cops.map((c) => ({ x: c.x, z: c.z })),
    };
  }
}
