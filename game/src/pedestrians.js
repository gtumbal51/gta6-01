// pedestrians.js — people walking the sidewalks, who flee from danger.
// V2: human-proportioned figures — taller slimmer torso, smaller head, hair
// styles, eyes, shoes, jacket over shirt, knees and elbows that bend.
// V2.2: rounder heads, tapered torsos, cylindrical limbs with hands, outfit
// variety (shorts, skirts, backpacks), and a walk cycle with torso sway and
// head bob. Pedestrians stand on the raised sidewalk (SIDEWALK_H) and drop
// to road level on crosswalks, matching the sidewalk geometry.
// Written for Solmar Bay: Street Heat (make.fun gta6-01).

import * as THREE from 'three';
import { clamp, dist2d, pick, rand, randInt } from './utils.js';
import { ROAD_HALF, ROAD_LINES, SIDEWALK_H } from './city.js';

const SHIRTS = [0xe84a4a, 0x4a8ae8, 0x4ae88a, 0xe8c84a, 0xe84ac8, 0x8a4ae8, 0xf0f0f0, 0x333338];
const PANTS = [0x2a3a5a, 0x3a2a2a, 0x222228, 0x4a5a3a, 0x5a4a3a];
const SKINS = [0xe8b890, 0xc89068, 0x8a5a38, 0xf0c8a0, 0x6a3a22];
const HAIR_COLORS = [0x1a1a1a, 0x2a1a10, 0x4a2a18, 0x5a5a5a, 0x8a6a3a, 0x3a2a1a];
const HAIR_STYLES = ['short', 'short', 'long', 'cap', 'flat'];

// A human-proportioned low-poly person, ~1.8 tall. Legs are ~48% of height,
// torso ~30%, head ~15% — the v1 figure had a giant head and stubby legs.
// Limbs are two segments on pivots (hip/knee, shoulder/elbow) so the walk
// cycle bends knees and elbows like a real gait instead of swinging planks.
// V2.2: round head, tapered torso, cylindrical limbs with hands, and outfit
// variety — shorts, skirts, backpacks — so no two passers-by look cloned.
// Returns { group, legL, legR, shinL, shinR, armL, armR, foreL, foreR,
//   torso, head, hair } — legL/armL rotate at hip/shoulder, shin/fore at
//   knee/elbow. opts: { shirt, pants, skin, hair, hairColor, female, jacket,
//   shorts, skirt, backpack }.
export function makePersonMesh(opts = {}) {
  const shirt = opts.shirt ?? 0xe84a4a;
  const pants = opts.pants ?? 0x2a3a5a;
  const skin = opts.skin ?? 0xe8b890;
  const female = !!opts.female;
  const hairStyle = opts.hair ?? 'short';
  const hairColor = opts.hairColor ?? 0x1a1a1a; // callers pass a seeded pick
  const jacketColor = opts.jacket ?? shirt;
  const shorts = !!opts.shorts;
  const skirt = !!opts.skirt;
  const backpack = !!opts.backpack;

  const group = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.65 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1e1c22, roughness: 0.55 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.95 });

  const shoulderW = female ? 0.40 : 0.46;
  const hipY = 0.88;

  // ---- Legs: thigh on a hip pivot, shin + shoe on a knee pivot. ----
  // Cylindrical limbs read as legs, not planks; shorts leave bare shins.
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(0.10 * side, hipY, 0);
    const thighLen = shorts ? 0.30 : 0.44;
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, thighLen, 8), pantsMat);
    thigh.position.y = -thighLen / 2;
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -thighLen;
    const shinLen = shorts ? 0.52 : 0.38;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, shinLen, 8), shorts ? skinMat : pantsMat);
    shin.position.y = -shinLen / 2;
    shin.castShadow = true;
    knee.add(shin);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.28), shoeMat);
    shoe.position.set(0, -shinLen - 0.02, 0.05);
    shoe.castShadow = true;
    knee.add(shoe);
    hip.add(knee);
    group.add(hip);
    return { hip, knee };
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  // Skirt: a flared cone over the hips (females only).
  if (skirt) {
    const skirtMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.26, 0.36, 10),
      new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 }),
    );
    skirtMesh.position.y = 0.72;
    skirtMesh.castShadow = true;
    group.add(skirtMesh);
  }

  // ---- Torso: tapered (narrow shoulders, wider hips would read boxy) —
  // a 4-sided frustum with flat faces front/back, jacket over a shirt. ----
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.52, 4), jacketMat);
  torso.rotation.y = Math.PI / 4;
  torso.position.y = 1.14;
  torso.castShadow = true;
  group.add(torso);
  // Shirt showing through the open jacket front.
  const shirtFront = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.44, 0.03),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 }),
  );
  shirtFront.position.set(0, 1.13, -0.17);
  group.add(shirtFront);
  // Belt.
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.30), shoeMat);
  belt.position.y = 0.90;
  group.add(belt);
  // Collar.
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.28), jacketMat);
  collar.position.y = 1.41;
  group.add(collar);
  // Backpack: small rounded pack on the back.
  if (backpack) {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.38, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 }),
    );
    pack.position.set(0, 1.16, 0.20);
    pack.castShadow = true;
    group.add(pack);
  }

  // ---- Arms: upper arm on a shoulder pivot, forearm + hand on elbow. ----
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set((shoulderW / 2 + 0.03) * side, 1.36, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.34, 8), jacketMat);
    upper.position.y = -0.17;
    upper.castShadow = true;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.30, 8), skinMat);
    fore.position.y = -0.15;
    fore.castShadow = true;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skinMat);
    hand.position.y = -0.33;
    elbow.add(hand);
    shoulder.add(elbow);
    group.add(shoulder);
    return { shoulder, elbow };
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---- Neck + head: round head (sphere, slightly tall), eyes, nose. ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 8), skinMat);
  neck.position.y = 1.44;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skinMat);
  head.scale.set(1, 1.18, 0.95);
  head.position.y = 1.60;
  head.castShadow = true;
  group.add(head);
  // Eyes: two small dark boxes on the face front (-Z is forward here? The
  // group faces -Z when heading is 0, so the face is on -Z).
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x181410, roughness: 0.4 });
  for (const ex of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.015), eyeMat);
    eye.position.set(ex, 1.62, -0.12);
    group.add(eye);
  }
  // Nose.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.03), skinMat);
  nose.position.set(0, 1.57, -0.125);
  group.add(nose);

  // Hair by style, fitted to the round head.
  let hair = null;
  if (hairStyle === 'short' || hairStyle === 'flat') {
    hair = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), hairMat);
    top.scale.set(1, hairStyle === 'flat' ? 0.45 : 0.7, 1);
    top.position.y = 1.68;
    hair.add(top);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.05), hairMat);
    back.position.set(0, 1.64, 0.10);
    hair.add(back);
    group.add(hair);
  } else if (hairStyle === 'long') {
    hair = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), hairMat);
    top.scale.set(1, 0.7, 1);
    top.position.y = 1.68;
    hair.add(top);
    // Hair falling past the shoulders.
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.06), hairMat);
    back.position.set(0, 1.46, 0.11);
    hair.add(back);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.20), hairMat);
    sideL.position.set(-0.13, 1.52, 0);
    hair.add(sideL);
    const sideR = sideL.clone();
    sideR.position.x = 0.13;
    hair.add(sideR);
    group.add(hair);
  } else if (hairStyle === 'cap') {
    hair = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), hairMat);
    dome.scale.set(1, 0.6, 1);
    dome.position.y = 1.69;
    hair.add(dome);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.16), hairMat);
    brim.position.set(0, 1.66, -0.18);
    hair.add(brim);
    group.add(hair);
  } else if (hairStyle === 'bandana') {
    hair = new THREE.Group();
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.25), hairMat);
    band.position.y = 1.70;
    hair.add(band);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.05), hairMat);
    knot.position.set(0, 1.64, 0.13);
    hair.add(knot);
    group.add(hair);
  }

  return {
    group,
    legL: legL.hip,
    legR: legR.hip,
    shinL: legL.knee,
    shinR: legR.knee,
    armL: armL.shoulder,
    armR: armR.shoulder,
    foreL: armL.elbow,
    foreR: armR.elbow,
    torso,
    head,
    hair,
  };
}

// Shared walk-cycle driver: hips swing, knees bend on the back-swing, elbows
// stay slightly bent and counter-swing. phase advances with distance walked.
// V2.2: the torso rolls and counter-twists a little and the head bobs, so the
// gait reads as a walk instead of a march. (The torso mesh carries a fixed
// π/4 yaw for its tapered faces — the sway is added on top of it.)
export function applyWalkCycle(mesh, phase, amount) {
  const swing = Math.sin(phase) * 0.55 * amount;
  const swingB = Math.sin(phase + Math.PI) * 0.55 * amount;
  mesh.legL.rotation.x = swing;
  mesh.legR.rotation.x = swingB;
  // Knee bends most as the leg swings back through.
  mesh.shinL.rotation.x = Math.max(0, -Math.sin(phase)) * 0.7 * amount;
  mesh.shinR.rotation.x = Math.max(0, -Math.sin(phase + Math.PI)) * 0.7 * amount;
  mesh.armL.rotation.x = -swing * 0.8;
  mesh.armR.rotation.x = -swingB * 0.8;
  mesh.foreL.rotation.x = -0.25 * amount;
  mesh.foreR.rotation.x = -0.25 * amount;
  // Torso sway: a little roll with each step, a counter-twist against the
  // hips, and a head bob on the step beat.
  mesh.torso.rotation.z = Math.sin(phase) * 0.045 * amount;
  mesh.torso.rotation.y = Math.PI / 4 - Math.sin(phase) * 0.07 * amount;
  mesh.head.position.y = 1.60 + Math.abs(Math.cos(phase)) * 0.03 * amount;
}

export class PedestrianSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.peds = [];
    for (let i = 0; i < 26; i++) this._spawnPed(true);
  }

  _spawnPed(anywhere) {
    const rng = this.rng;
    const horizontal = rng() < 0.5;
    const road = pick(rng, ROAD_LINES);
    const along = rand(rng, -240, 240);
    const side = (rng() < 0.5 ? -1 : 1) * (ROAD_HALF + 2.2);
    const x = horizontal ? along : road + side;
    const z = horizontal ? road + side : along;
    const heading = horizontal ? (rng() < 0.5 ? -Math.PI / 2 : Math.PI / 2) : rng() < 0.5 ? 0 : Math.PI;
    const female = rng() < 0.42;
    const mesh = makePersonMesh({
      shirt: pick(rng, SHIRTS),
      pants: pick(rng, PANTS),
      skin: pick(rng, SKINS),
      hair: female && rng() < 0.6 ? 'long' : pick(rng, HAIR_STYLES),
      hairColor: pick(rng, HAIR_COLORS),
      female,
      shorts: !female && rng() < 0.3,
      skirt: female && rng() < 0.3,
      backpack: rng() < 0.25,
    });
    // Spawned on a sidewalk, so they stand on the raised slab.
    mesh.group.position.set(x, SIDEWALK_H, z);
    mesh.group.rotation.y = heading;
    this.scene.add(mesh.group);
    const ped = {
      mesh,
      x,
      z,
      heading,
      horizontal,
      speed: rand(rng, 1.2, 2.2),
      walkPhase: rng() * Math.PI * 2,
      state: 'walk', // walk | flee
      fleeX: 0,
      fleeZ: 0,
      fleeTimer: 0,
    };
    this.peds.push(ped);
    return ped;
  }

  update(dt, threats) {
    // threats: [{x, z, radius, danger}] — player car, gunshots, police.
    for (const ped of this.peds) {
      let fleeing = ped.state === 'flee';
      for (const t of threats) {
        if (dist2d(ped.x, ped.z, t.x, t.z) < t.radius) {
          ped.state = 'flee';
          ped.fleeTimer = 2.5;
          const dx = ped.x - t.x;
          const dz = ped.z - t.z;
          const d = Math.max(Math.sqrt(dx * dx + dz * dz), 0.01);
          ped.fleeX = dx / d;
          ped.fleeZ = dz / d;
          fleeing = true;
          break;
        }
      }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        ped.heading = Math.atan2(-ped.fleeX, -ped.fleeZ);
        const sp = 5.5;
        ped.x += ped.fleeX * sp * dt;
        ped.z += ped.fleeZ * sp * dt;
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      } else {
        const sp = ped.speed;
        ped.x += -Math.sin(ped.heading) * sp * dt;
        ped.z += -Math.cos(ped.heading) * sp * dt;
        // Turn at intersections sometimes.
        if (this.rng() < dt * 0.25) {
          const onX = ROAD_LINES.some((r) => Math.abs(ped.x - r) < 4);
          const onZ = ROAD_LINES.some((r) => Math.abs(ped.z - r) < 4);
          if (onX && onZ) {
            ped.horizontal = !ped.horizontal;
            ped.heading = ped.horizontal
              ? this.rng() < 0.5
                ? -Math.PI / 2
                : Math.PI / 2
              : this.rng() < 0.5
                ? 0
                : Math.PI;
          }
        }
      }
      // Keep on sidewalks: clamp into the city and off the road centre.
      ped.x = clamp(ped.x, -268, 268);
      ped.z = clamp(ped.z, -268, 268);
      ped.walkPhase += dt * (ped.state === 'flee' ? 11 : 6);
      applyWalkCycle(ped.mesh, ped.walkPhase, ped.state === 'flee' ? 1 : 0.8);
      // Stand on the raised sidewalk; drop to road level on crosswalks.
      const groundY = this.city.isOnRoad(ped.x, ped.z) ? 0 : SIDEWALK_H;
      ped.mesh.group.position.set(ped.x, groundY, ped.z);
      ped.mesh.group.rotation.y = ped.heading;
    }
  }

  // Nearest pedestrian within radius, or null.
  nearest(x, z, radius) {
    let best = null;
    let bd = radius;
    for (const ped of this.peds) {
      const d = dist2d(x, z, ped.x, ped.z);
      if (d < bd) {
        bd = d;
        best = ped;
      }
    }
    return best;
  }

  // Remove a ped (hit by a car / shot) and respawn a fresh one elsewhere.
  remove(ped) {
    this.scene.remove(ped.mesh.group);
    const idx = this.peds.indexOf(ped);
    if (idx >= 0) this.peds.splice(idx, 1);
    this._spawnPed(true);
  }
}
