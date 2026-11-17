// vehicles.js — detailed car models, arcade driving physics, and traffic AI.
// V2: five body types (sedan / hatch / pickup / van / taxi), separate glass,
// grille, mirrors, licence plates, spoked rims, exhaust, and a seated driver
// silhouette inside every driven car. Written for Solmar Bay: Street Heat.

import * as THREE from 'three';
import { angleLerp, clamp, dist2d, hash2, lerpColor, pick, pushOutOfBox, rand, randInt } from './utils.js';
import { CITY_HALF, ROAD_HALF, ROAD_LINES } from './city.js';

export const CAR_COLORS = [0xc83228, 0x2a5ac8, 0xe8b828, 0x3a8a4a, 0x888888, 0xd8d8d8, 0x222226, 0x8a4ac8, 0x2a9a9a];

// One shared licence-plate texture: white plate, blue "SOLMAR BAY" strip.
let plateTexture = null;
function getPlateTexture() {
  if (plateTexture) return plateTexture;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 32;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2f2ea';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#1a4a8a';
  g.fillRect(0, 0, 128, 9);
  g.fillStyle = '#ffffff';
  g.font = 'bold 7px sans-serif';
  g.textAlign = 'center';
  g.fillText('SOLMAR BAY', 64, 7);
  g.fillStyle = '#222228';
  g.font = 'bold 14px sans-serif';
  g.fillText('7D-4821', 64, 25);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  plateTexture = tex;
  return tex;
}

// A seated driver figure: torso + head, sized to sit inside the cabin so
// driven cars read as occupied through the glass.
export function addDriver(group, opts = {}) {
  const driver = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: opts.shirt ?? 0x3a5a7a, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: opts.skin ?? 0xc89068, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.22), shirtMat);
  torso.position.y = 0.32;
  driver.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.21), skinMat);
  head.position.y = 0.72;
  driver.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.23), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }));
  hair.position.y = 0.86;
  driver.add(hair);
  // Arms reaching toward the wheel.
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.10), shirtMat);
    arm.position.set(0.26 * sx, 0.38, -0.16);
    arm.rotation.x = -0.9;
    driver.add(arm);
  }
  driver.position.set(opts.x ?? -0.42, opts.y ?? 0.62, opts.z ?? 0.05);
  group.add(driver);
  return driver;
}

// A car built from boxes and cylinders: body, cabin with separate glass,
// wheels with rims, lights, grille, mirrors, plates, bumpers, spoiler.
// Returns { group, wheels, headlights, taillights, lightBar?, length, width }.
// Cars face -Z when heading = 0, so headlights go at -length/2.
export function makeCarMesh(color, opts = {}) {
  const group = new THREE.Group();
  const bodyType = opts.body || (opts.sports ? 'sports' : 'sedan');
  // A touch of per-car paint variation so traffic never looks cloned.
  const paint = lerpColor(color, 0xffffff, hash2(color, 7) * 0.08);
  const bodyMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.30, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.10, metalness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.8 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8e0, roughness: 0.18, metalness: 0.9 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 });

  const dims = {
    sedan: { long: 4.2, wide: 1.9, cabinL: 0.46, cabinZ: -0.1, roofY: 1.58 },
    sports: { long: 4.6, wide: 1.9, cabinL: 0.44, cabinZ: 0.15, roofY: 1.52 },
    hatch: { long: 3.7, wide: 1.85, cabinL: 0.52, cabinZ: 0.1, roofY: 1.62 },
    pickup: { long: 4.6, wide: 1.95, cabinL: 0.34, cabinZ: -0.55, roofY: 1.66 },
    van: { long: 4.5, wide: 2.0, cabinL: 0.62, cabinZ: 0.1, roofY: 1.98 },
    taxi: { long: 4.2, wide: 1.9, cabinL: 0.46, cabinZ: -0.1, roofY: 1.58 },
  }[bodyType] || { long: 4.2, wide: 1.9, cabinL: 0.46, cabinZ: -0.1, roofY: 1.58 };
  const long = dims.long;
  const wide = dims.wide;

  // Lower body with a slightly sculpted deck.
  const body = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.62, long), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.94, 0.22, long * 0.92), bodyMat);
  deck.position.y = 0.92;
  deck.castShadow = true;
  group.add(deck);
  // Side skirts.
  for (const x of [-wide / 2 + 0.03, wide / 2 - 0.03]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, long * 0.6), darkMat);
    skirt.position.set(x, 0.32, 0);
    group.add(skirt);
  }

  if (bodyType === 'pickup') {
    // Cab + open bed with walls.
    const cab = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.84, 0.62, long * 0.30), glassMat);
    cab.position.set(0, 1.28, dims.cabinZ);
    cab.castShadow = true;
    group.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.82, 0.08, long * 0.28), bodyMat);
    cabRoof.position.set(0, 1.62, dims.cabinZ);
    group.add(cabRoof);
    for (const [x, z, w, d] of [[-wide / 2 + 0.05, 1.15, 0.08, 1.9], [wide / 2 - 0.05, 1.15, 0.08, 1.9], [0, 2.08, wide - 0.1, 0.08]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, d), bodyMat);
      wall.position.set(x, 1.05, z);
      group.add(wall);
    }
  } else {
    // Cabin: glasshouse with a body-coloured roof and pillars.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.82, 0.55, long * dims.cabinL), glassMat);
    cabin.position.set(0, 1.28, dims.cabinZ);
    cabin.castShadow = true;
    group.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.8, 0.08, long * (dims.cabinL - 0.06)), bodyMat);
    roof.position.set(0, dims.roofY, dims.cabinZ);
    group.add(roof);
    // Windshield: a slightly tilted glass panel at the front of the cabin.
    const shield = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.78, 0.5, 0.04), glassMat);
    shield.position.set(0, 1.26, dims.cabinZ - long * dims.cabinL * 0.5 - 0.02);
    shield.rotation.x = -0.28;
    group.add(shield);
    // Rear window.
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.78, 0.44, 0.04), glassMat);
    rearGlass.position.set(0, 1.26, dims.cabinZ + long * dims.cabinL * 0.5 + 0.02);
    rearGlass.rotation.x = 0.22;
    group.add(rearGlass);
    // B and C pillars (body colour, thin).
    for (const z of [dims.cabinZ - long * dims.cabinL * 0.22, dims.cabinZ + long * dims.cabinL * 0.22]) {
      for (const x of [-wide * 0.41, wide * 0.41]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 0.07), bodyMat);
        pillar.position.set(x, 1.28, z);
        group.add(pillar);
      }
    }
  }
  if (bodyType === 'van') {
    // Tall slab sides with painted windows.
    for (const x of [-wide / 2 + 0.02, wide / 2 - 0.02]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, long * 0.5), glassMat);
      win.position.set(x, 1.5, 0.2);
      group.add(win);
    }
  }
  // Front grille + chrome bar.
  const grille = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.6, 0.2, 0.08), darkMat);
  grille.position.set(0, 0.62, -long / 2 - 0.02);
  group.add(grille);
  const grilleBar = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.62, 0.05, 0.09), chromeMat);
  grilleBar.position.set(0, 0.74, -long / 2 - 0.02);
  group.add(grilleBar);
  // Bumpers.
  for (const z of [-long / 2 + 0.08, long / 2 - 0.08]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.98, 0.22, 0.14), bodyMat);
    bumper.position.set(0, 0.42, z);
    group.add(bumper);
  }
  // Round headlight lenses.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff8d0, emissive: 0xfff2a8, emissiveIntensity: 0.9 });
  const headlights = [];
  for (const x of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), headMat);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(x, 0.72, -long / 2 - 0.02);
    group.add(hl);
    headlights.push(hl);
  }
  // Full-width taillight bar.
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xc81818, emissive: 0x881111, emissiveIntensity: 0.8 });
  const taillights = [];
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.8, 0.14, 0.08), tailMat);
  tailBar.position.set(0, 0.72, long / 2 + 0.02);
  group.add(tailBar);
  taillights.push(tailBar);
  // Licence plates, front and back.
  const plateMat = new THREE.MeshStandardMaterial({ map: getPlateTexture(), roughness: 0.4 });
  for (const z of [-long / 2 - 0.06, long / 2 + 0.06]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.02), plateMat);
    plate.position.set(0, 0.44, z);
    if (z > 0) plate.rotation.y = Math.PI;
    group.add(plate);
  }
  // Side mirrors.
  for (const x of [-wide / 2 - 0.08, wide / 2 + 0.08]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.16), bodyMat);
    mirror.position.set(x, 1.12, dims.cabinZ - long * dims.cabinL * 0.42);
    group.add(mirror);
  }
  // Exhaust pipe.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), chromeMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(wide * 0.3, 0.3, long / 2 + 0.06);
  group.add(exhaust);
  // Wheels: tyre + rim + spokes.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[-0.88, -1.45], [0.88, -1.45], [-0.88, 1.45], [0.88, 1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, tireMat);
    wheel.position.set(x, 0.36, z);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
    const rim = new THREE.Mesh(rimGeo, chromeMat);
    rim.position.set(x, 0.36, z);
    group.add(rim);
    // Two crossed spokes on the outer face.
    for (const rot of [0, Math.PI / 2]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.05), chromeMat);
      spoke.position.set(x + (x > 0 ? 0.15 : -0.15), 0.36, z);
      spoke.rotation.x = rot;
      group.add(spoke);
    }
  }
  // Spoiler for sports cars.
  if (bodyType === 'sports') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.4), darkMat);
    spoiler.position.set(0, 1.12, long / 2 - 0.35);
    group.add(spoiler);
    for (const x of [-0.7, 0.7]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), darkMat);
      strut.position.set(x, 0.98, long / 2 - 0.35);
      group.add(strut);
    }
  }
  // Taxi: roof sign + checker band.
  if (bodyType === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: 0xffe94a, emissive: 0xa8821a, emissiveIntensity: 0.4 }));
    sign.position.set(0, dims.roofY + 0.13, dims.cabinZ);
    group.add(sign);
    const band = new THREE.Mesh(new THREE.BoxGeometry(wide + 0.02, 0.16, long * 0.7), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6 }));
    band.position.set(0, 0.98, 0);
    group.add(band);
  }
  // Police livery: white doors + light bar + "POLICE" door panels.
  let lightBar = null;
  if (opts.police) {
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.3 });
    for (const x of [-0.96, 0.96]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.4), doorMat);
      door.position.set(x, 0.62, 0.1);
      group.add(door);
    }
    lightBar = new THREE.Group();
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 1.4 }),
    );
    red.position.x = -0.32;
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x1020ff, emissiveIntensity: 1.4 }),
    );
    blue.position.x = 0.32;
    lightBar.add(red);
    lightBar.add(blue);
    lightBar.position.set(0, 1.66, 0);
    lightBar.userData.red = red;
    lightBar.userData.blue = blue;
    group.add(lightBar);
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group, wheels, headlights, taillights, lightBar, length: long, width: wide, bodyType };
}

// Arcade car state shared by the player car and police cars.
export function createCarState(x, z, heading, opts = {}) {
  return {
    x,
    z,
    heading,
    speed: 0,
    maxSpeed: opts.maxSpeed ?? 30,
    accel: opts.accel ?? 15,
    brake: 34,
    steer: 0,
    health: opts.health ?? 100,
    color: opts.color ?? 0x888888,
    sports: !!opts.sports,
    police: !!opts.police,
    body: opts.body ?? (opts.sports ? 'sports' : 'sedan'),
    mesh: null,
  };
}

// Drive one step. input: {throttle -1..1, steer -1..1, handbrake bool}.
export function stepCar(car, input, dt, city, onCrash) {
  const prevSpeed = car.speed;
  if (input.throttle > 0) {
    car.speed += car.accel * input.throttle * dt;
  } else if (input.throttle < 0) {
    if (car.speed > 0.5) car.speed += car.brake * input.throttle * dt;
    else car.speed += car.accel * 0.55 * input.throttle * dt; // reverse
  } else {
    car.speed -= Math.sign(car.speed) * 6 * dt;
    if (Math.abs(car.speed) < 0.2) car.speed = 0;
  }
  if (input.handbrake) car.speed -= Math.sign(car.speed) * 22 * dt;
  car.speed = clamp(car.speed, -10, car.maxSpeed);
  // Steering scales down at high speed, reverses when reversing.
  const steerAuthority = clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed >= 0 ? 1 : -1);
  car.heading += input.steer * 1.9 * steerAuthority * dt * (input.handbrake ? 1.5 : 1);
  const nx = car.x + Math.sin(car.heading) * -car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * -car.speed * dt;
  car.x = nx;
  car.z = nz;
  // Building collisions.
  const r = 1.5;
  for (const box of city.colliders) {
    if (car.x < box.x0 - r || car.x > box.x1 + r || car.z < box.z0 - r || car.z > box.z1 + r) continue;
    const out = pushOutOfBox(car.x, car.z, r, box);
    if (out) {
      car.x = out.x;
      car.z = out.z;
      if (Math.abs(car.speed) > 4 && onCrash) onCrash(Math.abs(car.speed));
      car.speed *= 0.45;
    }
  }
  const c = city.clampToCity(car.x, car.z);
  if (c.x !== car.x || c.z !== car.z) {
    car.x = c.x;
    car.z = c.z;
    car.speed *= 0.5;
  }
  if (car.mesh) {
    car.mesh.group.position.set(car.x, 0, car.z);
    car.mesh.group.rotation.y = car.heading;
    const spin = car.speed * dt * 2.8;
    for (const w of car.mesh.wheels) w.rotation.x += spin;
    // Body lean / pitch.
    car.mesh.group.rotation.z = -input.steer * clamp(Math.abs(car.speed) / 30, 0, 1) * 0.06;
    car.mesh.group.rotation.x = clamp((car.speed - prevSpeed) / dt, -6, 6) * 0.004;
  }
}

const TRAFFIC_BODIES = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'pickup', 'van', 'taxi', 'sports'];

export class TrafficSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.cars = [];
    for (let i = 0; i < 14; i++) this._spawnCar(true);
  }

  _spawnCar(anywhere) {
    const rng = this.rng;
    const horizontal = rng() < 0.5;
    const road = pick(rng, ROAD_LINES);
    const along = anywhere ? rand(rng, -240, 240) : pick(rng, [-260, 260]);
    const lane = (rng() < 0.5 ? -1 : 1) * 3.4;
    const dir = rng() < 0.5 ? 1 : -1;
    const x = horizontal ? along : road + lane;
    const z = horizontal ? road + lane : along;
    const heading = horizontal ? (dir > 0 ? -Math.PI / 2 : Math.PI / 2) : dir > 0 ? Math.PI : 0;
    const color = pick(rng, CAR_COLORS);
    const body = pick(rng, TRAFFIC_BODIES);
    const mesh = makeCarMesh(color, { body });
    addDriver(mesh.group, { shirt: pick(rng, [0x3a5a7a, 0x7a3a3a, 0x3a7a4a, 0x8a8a8a]), skin: pick(rng, [0xe8b890, 0xc89068, 0x8a5a38]) });
    this.scene.add(mesh.group);
    const car = {
      mesh,
      x,
      z,
      heading,
      horizontal,
      road,
      lane,
      dir,
      speed: rand(rng, 7, 12),
      cruise: rand(rng, 8, 13),
      stopped: 0,
    };
    mesh.group.position.set(x, 0, z);
    mesh.group.rotation.y = heading;
    this.cars.push(car);
    return car;
  }

  // Keep traffic flowing; cars turn at intersections sometimes, respawn at edges.
  update(dt, playerCar, onBump) {
    for (const car of this.cars) {
      // Slow down if something is right ahead.
      let ahead = 99;
      const fx = -Math.sin(car.heading);
      const fz = -Math.cos(car.heading);
      for (const other of this.cars) {
        if (other === car) continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 9) {
          const dot = (dx * fx + dz * fz) / Math.max(d, 0.001);
          if (dot > 0.6) ahead = Math.min(ahead, d);
        }
      }
      if (playerCar) {
        const d = dist2d(car.x, car.z, playerCar.x, playerCar.z);
        if (d < 8) {
          const dot = ((playerCar.x - car.x) * fx + (playerCar.z - car.z) * fz) / Math.max(d, 0.001);
          if (dot > 0.5) ahead = Math.min(ahead, d);
        }
      }
      const target = ahead < 9 ? 0 : car.cruise;
      car.speed += clamp(target - car.speed, -14 * dt, 8 * dt);
      car.x += -Math.sin(car.heading) * car.speed * dt;
      car.z += -Math.cos(car.heading) * car.speed * dt;
      // Turn at an intersection sometimes.
      const nearLine = (v) => {
        for (const r of ROAD_LINES) if (Math.abs(v - r) < 3) return r;
        return null;
      };
      if (car.speed > 1 && this.rng() < dt * 0.35) {
        const crossX = nearLine(car.x);
        const crossZ = nearLine(car.z);
        if (crossX !== null && crossZ !== null && this.rng() < 0.5) {
          // Turn onto the crossing road.
          const newHorizontal = !car.horizontal;
          const newLane = (this.rng() < 0.5 ? -1 : 1) * 3.4;
          const newDir = this.rng() < 0.5 ? 1 : -1;
          if (newHorizontal) {
            car.z = crossZ + newLane;
            car.heading = newDir > 0 ? -Math.PI / 2 : Math.PI / 2;
          } else {
            car.x = crossX + newLane;
            car.heading = newDir > 0 ? Math.PI : 0;
          }
          car.horizontal = newHorizontal;
          car.road = newHorizontal ? car.z : car.x;
          car.lane = newLane;
          car.dir = newDir;
        }
      }
      // Respawn at the far edge when leaving the city.
      if (Math.abs(car.x) > CITY_HALF + 20 || Math.abs(car.z) > CITY_HALF + 20) {
        this.scene.remove(car.mesh.group);
        const idx = this.cars.indexOf(car);
        this.cars.splice(idx, 1);
        this._spawnCar(false);
        continue;
      }
      car.mesh.group.position.set(car.x, 0, car.z);
      car.mesh.group.rotation.y = car.heading;
      const spin = car.speed * dt * 2.8;
      for (const w of car.mesh.wheels) w.rotation.x += spin;
      // Bump into the player's car.
      if (playerCar && onBump) {
        const d = dist2d(car.x, car.z, playerCar.x, playerCar.z);
        if (d < 3.2) {
          const push = (3.2 - d) / 3.2;
          const nx = (playerCar.x - car.x) / Math.max(d, 0.01);
          const nz = (playerCar.z - car.z) / Math.max(d, 0.01);
          playerCar.x += nx * push * 1.2;
          playerCar.z += nz * push * 1.2;
          car.x -= nx * push * 0.6;
          car.z -= nz * push * 0.6;
          onBump(Math.abs(playerCar.speed) + car.speed);
        }
      }
    }
  }

  // Parked cars the player can steal: fixed spots near landmarks, each a
  // distinct body type so the player can tell them apart at a glance.
  spawnParkedCars() {
    const spots = [
      { x: 8, z: 4, heading: Math.PI / 2, color: 0xc83228, body: 'sports', name: 'Comet GT' },
      { x: -172, z: -186, heading: 0, color: 0x2a5ac8, body: 'sedan', name: 'Sedan' },
      { x: 232, z: 262, heading: Math.PI, color: 0xe8b828, body: 'taxi', name: 'Taxi' },
      { x: -232, z: 64, heading: -Math.PI / 2, color: 0x3a8a4a, body: 'pickup', name: 'Pickup' },
      { x: 64, z: -232, heading: Math.PI / 2, color: 0x8a4ac8, body: 'sports', name: 'Comet GT' },
    ];
    this.parked = spots.map((s) => {
      const mesh = makeCarMesh(s.color, { body: s.body, sports: s.body === 'sports' });
      mesh.group.position.set(s.x, 0, s.z);
      mesh.group.rotation.y = s.heading;
      this.scene.add(mesh.group);
      return { ...s, mesh, taken: false };
    });
    return this.parked;
  }
}
