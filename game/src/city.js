// city.js — builds Solmar Bay: a 9x9 block grid city with a beach, a plaza, parks,
// varied buildings with procedural window facades, palms and streetlights.
// V2: richer street markings (edge lines, stop bars, parking bays, sidewalk
// tiles), shop signs and balconies on the facades, a gradient sky with a
// glowing sun, traffic lights, bus stops, round-canopy trees and curbs.
// Exports the layout data (roads, colliders, landmarks) the other systems use.

import * as THREE from 'three';
import { clamp, dist2d, hash2, pick, rand, randInt } from './utils.js';

export const PITCH = 60; // distance between road centrelines
export const ROAD_HALF = 7; // half the road width
export const CITY_HALF = 270; // city spans -270..270 on both axes
export const ROAD_LINES = [-240, -180, -120, -60, 0, 60, 120, 180, 240];

const PALETTE = {
  facades: [0xd8c9a3, 0xc9b8a0, 0xb8c4c9, 0xd9a08a, 0xa8b8a0, 0xc9a8b8, 0xe0d0b8, 0x9fb4c7, 0xd8b878],
  roofs: [0x8a7a68, 0x6a6a72, 0x7a5a4a, 0x5a6a7a],
  trims: [0x3a4a5a, 0x5a3a3a, 0x2a3a2a, 0x6a5a3a],
};

const SHOP_SIGNS = [
  { name: 'TACOS', color: '#ff5a3c' },
  { name: 'HOTEL MARINA', color: '#39c2ff' },
  { name: 'PIER 9', color: '#ffd23f' },
  { name: 'LAUNDRY', color: '#7affc4' },
  { name: 'BAR 24', color: '#ff5a7a' },
  { name: 'SURF SHOP', color: '#4ae8e8' },
  { name: 'DONUTS', color: '#e84ac8' },
  { name: 'PHARMACY', color: '#9fe870' },
];

function facadeTexture(rng, baseColor, floors, cols, litRatio) {
  const w = 128;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const base = new THREE.Color(baseColor);
  g.fillStyle = '#' + base.getHexString();
  g.fillRect(0, 0, w, h);
  // Subtle vertical shading so flat walls read as concrete panels.
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`;
    g.fillRect(Math.floor((i / 8) * w), 0, 2, h);
  }
  const cellW = w / cols;
  const cellH = h / floors;
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const lit = rng() < litRatio;
      const x = c * cellW + cellW * 0.22;
      const y = f * cellH + cellH * 0.22;
      if (lit) {
        const warm = rng() < 0.7;
        g.fillStyle = warm ? '#ffd98a' : '#bfe0ff';
        g.fillRect(x, y, cellW * 0.56, cellH * 0.52);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x, y, cellW * 0.56, 2);
      } else {
        g.fillStyle = 'rgba(20,28,38,0.85)';
        g.fillRect(x, y, cellW * 0.56, cellH * 0.52);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x, y, cellW * 0.56, 2);
      }
      // Balcony rail under some upper-floor windows.
      if (f > 0 && rng() < 0.35) {
        g.fillStyle = 'rgba(40,40,46,0.9)';
        g.fillRect(x - 2, y + cellH * 0.52, cellW * 0.56 + 4, 3);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x - 2, y + cellH * 0.52 + 3, cellW * 0.56 + 4, cellH * 0.2);
      }
      // AC box under some windows.
      if (rng() < 0.25) {
        g.fillStyle = 'rgba(200,200,195,0.85)';
        g.fillRect(x + cellW * 0.1, y + cellH * 0.56, cellW * 0.3, cellH * 0.16);
      }
    }
  }
  // Ground-floor shopfront: glass band + a painted shop sign.
  g.fillStyle = 'rgba(30,30,36,0.9)';
  g.fillRect(0, h - cellH * 0.9, w, cellH * 0.9);
  g.fillStyle = '#ffd98a';
  for (let c = 0; c < cols; c++) {
    if (rng() < 0.6) g.fillRect(c * cellW + 3, h - cellH * 0.75, cellW - 6, cellH * 0.5);
  }
  const sign = pick(rng, SHOP_SIGNS);
  g.fillStyle = sign.color;
  g.fillRect(4, h - cellH * 0.98, w - 8, Math.max(9, cellH * 0.16));
  g.fillStyle = '#101018';
  g.font = `bold ${Math.max(9, Math.floor(cellH * 0.11))}px sans-serif`;
  g.textAlign = 'center';
  g.fillText(sign.name, w / 2, h - cellH * 0.98 + Math.max(8, cellH * 0.12));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function groundTexture(rng) {
  // One 2048 canvas painted with the whole street plan: asphalt roads, lane
  // dashes, edge lines, stop bars, crosswalks, parking bays, sidewalk tiles,
  // block interiors, a park, and the beach.
  const S = 2048;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const worldToPx = (v) => ((v + CITY_HALF + 40) / (CITY_HALF * 2 + 80)) * S;
  // Base: sidewalk concrete.
  g.fillStyle = '#9a938a';
  g.fillRect(0, 0, S, S);
  // Sidewalk tile grid.
  g.strokeStyle = 'rgba(0,0,0,0.07)';
  g.lineWidth = 1;
  const tileStep = worldToPx(6) - worldToPx(0);
  for (let t = 0; t < S; t += tileStep) {
    g.beginPath();
    g.moveTo(t, 0);
    g.lineTo(t, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, t);
    g.lineTo(S, t);
    g.stroke();
  }
  // Block interiors: slightly varied warm grey, some green park blocks.
  // There are 8 blocks between the 9 road lines on each axis.
  for (let bi = 0; bi < 8; bi++) {
    for (let bj = 0; bj < 8; bj++) {
      const x0 = ROAD_LINES[bi] + ROAD_HALF + 2;
      const z0 = ROAD_LINES[bj] + ROAD_HALF + 2;
      const x1 = ROAD_LINES[bi + 1] - ROAD_HALF - 2;
      const z1 = ROAD_LINES[bj + 1] - ROAD_HALF - 2;
      const px = worldToPx(x0);
      const pz = worldToPx(z0);
      const pw = worldToPx(x1) - px;
      const ph = worldToPx(z1) - pz;
      const isPark = (bi === 2 && bj === 6) || (bi === 6 && bj === 2);
      const isPlaza = bi === 4 && bj === 4;
      if (isPark) {
        g.fillStyle = '#5d8a4a';
      } else if (isPlaza) {
        g.fillStyle = '#b8a888';
      } else {
        // Deterministic per-block shade (hash2, not the shared rng, so the
        // block colours never shift the seeded sequence other systems use).
        const shade = 138 + Math.floor(hash2(bi * 31 + 7, bj * 17 + 3) * 22);
        g.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
      }
      g.fillRect(px, pz, pw, ph);
    }
  }
  // Roads: asphalt strips.
  g.fillStyle = '#3c3f45';
  for (const line of ROAD_LINES) {
    const p = worldToPx(line - ROAD_HALF);
    const w = worldToPx(line + ROAD_HALF) - p;
    g.fillRect(p, 0, w, S);
    g.fillRect(0, p, S, w);
  }
  // White edge lines along each road.
  g.fillStyle = 'rgba(240,240,235,0.75)';
  for (const line of ROAD_LINES) {
    const e1 = worldToPx(line - ROAD_HALF + 0.6);
    const e2 = worldToPx(line + ROAD_HALF - 0.6);
    g.fillRect(e1, 0, 2, S);
    g.fillRect(e2, 0, 2, S);
    g.fillRect(0, e1, S, 2);
    g.fillRect(0, e2, S, 2);
  }
  // Lane dashes (centre of each road).
  g.fillStyle = '#e8d878';
  for (const line of ROAD_LINES) {
    const p = worldToPx(line);
    for (let t = -CITY_HALF; t < CITY_HALF; t += 12) {
      g.fillRect(worldToPx(t), p - 2, worldToPx(t + 5) - worldToPx(t), 4);
      g.fillRect(p - 2, worldToPx(t), 4, worldToPx(t + 5) - worldToPx(t));
    }
  }
  // Stop bars before every intersection, plus manhole covers.
  g.fillStyle = 'rgba(240,240,235,0.9)';
  for (const rx of ROAD_LINES) {
    for (const rz of ROAD_LINES) {
      const px = worldToPx(rx);
      const pz = worldToPx(rz);
      const barW = worldToPx(rx - ROAD_HALF - 1) - worldToPx(rx - ROAD_HALF - 4);
      const barH = worldToPx(rz + 6) - worldToPx(rz - 6);
      // Bar across the lane of the road running along X, just before the box.
      g.fillRect(worldToPx(rx - ROAD_HALF - 4), worldToPx(rz - 6), barW, barH);
      // Bar across the lane of the road running along Z.
      g.fillRect(worldToPx(rx - 6), worldToPx(rz - ROAD_HALF - 4), barH, barW);
      g.fillStyle = 'rgba(20,20,24,0.5)';
      g.beginPath();
      g.arc(px + 12, pz + 12, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(240,240,235,0.9)';
    }
  }
  // Crosswalks at every intersection.
  g.fillStyle = 'rgba(240,240,235,0.85)';
  for (const rx of ROAD_LINES) {
    for (const rz of ROAD_LINES) {
      const px = worldToPx(rx);
      const pz = worldToPx(rz);
      for (let i = -3; i <= 3; i++) {
        g.fillRect(px + i * 8 - 3, pz - ROAD_HALF - 6, 5, 12);
        g.fillRect(px - ROAD_HALF - 6, pz + i * 8 - 3, 12, 5);
      }
    }
  }
  // Parking bays along the main avenues (white T marks on the road edge).
  g.fillStyle = 'rgba(240,240,235,0.55)';
  for (const line of [-180, -60, 60, 180]) {
    for (let t = -230; t < 230; t += 24) {
      if (ROAD_LINES.some((r) => Math.abs(t - r) < 12)) continue;
      g.fillRect(worldToPx(line + ROAD_HALF - 1.4), worldToPx(t), 3, worldToPx(t + 9) - worldToPx(t));
      g.fillRect(worldToPx(t), worldToPx(line + ROAD_HALF - 1.4), worldToPx(t + 9) - worldToPx(t), 3);
    }
  }
  // Beach: sand strip + water at the south edge (z > CITY_HALF).
  const sandTop = worldToPx(CITY_HALF);
  g.fillStyle = '#e8d8a8';
  g.fillRect(0, sandTop, S, S - sandTop);
  const waterTop = worldToPx(CITY_HALF + 22);
  g.fillStyle = '#2a7ab8';
  g.fillRect(0, waterTop, S, S - waterTop);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 40; i++) {
    const y = waterTop + 10 + rng() * (S - waterTop - 20);
    const x = rng() * S;
    g.fillRect(x, y, 30 + rng() * 60, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function nearestRoadCoord(v) {
  let best = ROAD_LINES[0];
  let bd = Infinity;
  for (const r of ROAD_LINES) {
    const d = Math.abs(v - r);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

export function snapToRoad(v) {
  return nearestRoadCoord(v);
}

export class City {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.colliders = []; // {x0,z0,x1,z1}
    this.buildings = []; // {x,z,w,d,h}
    this.landmarks = {
      louCorner: { x: -178, z: -178 },
      docks: { x: 238, z: 268 },
      garage: { x: -238, z: 238 },
      plaza: { x: 0, z: 0 },
      chopShop: { x: 238, z: -238 },
      dropOff: { x: -238, z: 58 },
      hospital: { x: 58, z: -238 },
      cashSpots: [
        { x: 178, z: 178 },
        { x: -118, z: 118 },
        { x: 118, z: -118 },
      ],
    };
    this._buildGround();
    this._buildSky();
    this._buildBuildings();
    this._buildProps();
  }

  _buildGround() {
    const tex = groundTexture(this.rng);
    const size = CITY_HALF * 2 + 80;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // Ocean plane beyond the beach, slightly animated by the main loop via userData.
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 300),
      new THREE.MeshStandardMaterial({ color: 0x1a6aa8, roughness: 0.25, metalness: 0.1 }),
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, -0.15, CITY_HALF + 170);
    ocean.userData.isOcean = true;
    this.scene.add(ocean);
    this.ocean = ocean;
    this._buildCurbs();
  }

  _buildCurbs() {
    // Low concrete curbs along both edges of every road, skipping the
    // intersection mouths so crosswalks stay open. One InstancedMesh.
    const positions = [];
    for (const line of ROAD_LINES) {
      for (let t = -CITY_HALF; t <= CITY_HALF; t += 10) {
        if (ROAD_LINES.some((r) => Math.abs(t - r) < ROAD_HALF + 3)) continue;
        positions.push([line - ROAD_HALF - 0.4, t, 0]);
        positions.push([line + ROAD_HALF + 0.4, t, 0]);
        positions.push([t, line - ROAD_HALF - 0.4, 1]);
        positions.push([t, line + ROAD_HALF + 0.4, 1]);
      }
    }
    const geo = new THREE.BoxGeometry(10, 0.14, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 });
    const curbs = new THREE.InstancedMesh(geo, mat, positions.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    positions.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(up, rot ? Math.PI / 2 : 0);
      m.compose(new THREE.Vector3(x, 0.07, z), q, new THREE.Vector3(1, 1, 1));
      curbs.setMatrixAt(i, m);
    });
    curbs.receiveShadow = true;
    this.scene.add(curbs);
  }

  _buildSky() {
    // Gradient sky: deep blue at the zenith fading to a warm pale horizon.
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#3f7ec2');
    grad.addColorStop(0.45, '#7fb8e8');
    grad.addColorStop(0.72, '#cfe8f8');
    grad.addColorStop(1, '#ffe8c0');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(cv);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyGeo = new THREE.SphereGeometry(900, 24, 12);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
    // Sun disc + a soft glow sprite.
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(34, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false }),
    );
    sun.position.set(-420, 320, -560);
    sun.lookAt(0, 0, 0);
    this.scene.add(sun);
    const glowCv = document.createElement('canvas');
    glowCv.width = 128;
    glowCv.height = 128;
    const gg = glowCv.getContext('2d');
    const radial = gg.createRadialGradient(64, 64, 4, 64, 64, 64);
    radial.addColorStop(0, 'rgba(255,242,200,0.9)');
    radial.addColorStop(0.5, 'rgba(255,220,150,0.35)');
    radial.addColorStop(1, 'rgba(255,220,150,0)');
    gg.fillStyle = radial;
    gg.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCv);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, fog: false, depthWrite: false }),
    );
    glow.position.set(-420, 320, -560);
    glow.lookAt(0, 0, 0);
    this.scene.add(glow);
    // A few flat clouds, some with a warm sunlit edge.
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + randInt(this.rng, 0, 3);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(rand(this.rng, 14, 30), 10, 8), cloudMat);
        s.position.set(p * 22 - puffs * 10, rand(this.rng, -4, 4), rand(this.rng, -8, 8));
        s.scale.y = 0.45;
        cloud.add(s);
      }
      cloud.position.set(rand(this.rng, -600, 600), rand(this.rng, 180, 300), rand(this.rng, -600, 300));
      this.scene.add(cloud);
    }
  }

  _buildBuildings() {
    const rng = this.rng;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.BoxGeometry(1, 1, 1);
    // 8x8 blocks sit between the 9 road lines.
    for (let bi = 0; bi < 8; bi++) {
      for (let bj = 0; bj < 8; bj++) {
        const isPark = (bi === 2 && bj === 6) || (bi === 6 && bj === 2);
        const isPlaza = bi === 4 && bj === 4;
        const bx0 = ROAD_LINES[bi] + ROAD_HALF + 3;
        const bz0 = ROAD_LINES[bj] + ROAD_HALF + 3;
        const bx1 = ROAD_LINES[bi + 1] - ROAD_HALF - 3;
        const bz1 = ROAD_LINES[bj + 1] - ROAD_HALF - 3;
        if (isPark) {
          this._buildPark(bx0, bz0, bx1, bz1);
          continue;
        }
        if (isPlaza) {
          this._buildPlaza(bx0, bz0, bx1, bz1);
          continue;
        }
        const centreDist = dist2d((bx0 + bx1) / 2, (bz0 + bz1) / 2, 0, 0);
        const tall = centreDist < 130;
        const count = tall ? randInt(rng, 1, 2) : randInt(rng, 2, 4);
        const w = (bx1 - bx0) / (count === 1 ? 1 : 2);
        const d = (bz1 - bz0) / (count <= 2 ? 1 : 2);
        let placed = 0;
        for (let gx = 0; gx < 2 && placed < count; gx++) {
          for (let gz = 0; gz < 2 && placed < count; gz++) {
            const cx = bx0 + gx * w + w / 2;
            const cz = bz0 + gz * d + d / 2;
            const bw = w * rand(rng, 0.62, 0.85);
            const bd = d * rand(rng, 0.62, 0.85);
            const floors = tall ? randInt(rng, 8, 18) : randInt(rng, 2, 6);
            const h = floors * 3.4;
            const facade = pick(rng, PALETTE.facades);
            const tex = facadeTexture(rng, facade, floors, Math.max(3, Math.round(bw / 6)), 0.35);
            const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 });
            const mesh = new THREE.Mesh(boxGeo, mat);
            mesh.scale.set(bw, h, bd);
            mesh.position.set(cx, h / 2, cz);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            // Roof slab + rooftop boxes (AC units, water tank, antenna).
            const roofMat = new THREE.MeshStandardMaterial({ color: pick(rng, PALETTE.roofs), roughness: 0.95 });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.scale.set(bw + 0.8, 0.7, bd + 0.8);
            roof.position.set(cx, h + 0.35, cz);
            roof.castShadow = true;
            this.scene.add(roof);
            const units = randInt(rng, 1, 3);
            for (let u = 0; u < units; u++) {
              const unit = new THREE.Mesh(roofGeo, roofMat);
              unit.scale.set(rand(rng, 1.5, 3), rand(rng, 0.8, 1.6), rand(rng, 1.5, 3));
              unit.position.set(cx + rand(rng, -bw / 4, bw / 4), h + 1.2, cz + rand(rng, -bd / 4, bd / 4));
              this.scene.add(unit);
            }
            if (tall && rng() < 0.45) {
              // Water tank: cylinder + cone cap.
              const tankMat = new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 });
              const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 10), tankMat);
              tank.position.set(cx + bw / 4, h + 2, cz - bd / 4);
              this.scene.add(tank);
              const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.1, 10), tankMat);
              cap.position.set(cx + bw / 4, h + 3.8, cz - bd / 4);
              this.scene.add(cap);
              // Antenna mast.
              const ant = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.12, 6, 6),
                new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.4 }),
              );
              ant.position.set(cx - bw / 4, h + 3.6, cz + bd / 4);
              this.scene.add(ant);
            }
            // 3D balconies on the street-facing side of taller blocks.
            if (floors >= 4) {
              const balconies = randInt(rng, 1, 2);
              const face = rng() < 0.5 ? 1 : -1; // which z face
              for (let b = 0; b < balconies; b++) {
                const by = rand(rng, 8, h - 6);
                const slab = new THREE.Mesh(
                  new THREE.BoxGeometry(Math.min(7, bw * 0.4), 0.3, 1.6),
                  new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.9 }),
                );
                slab.position.set(cx + rand(rng, -bw / 4, bw / 4), by, cz + face * (bd / 2 + 0.8));
                slab.castShadow = true;
                this.scene.add(slab);
                const rail = new THREE.Mesh(
                  new THREE.BoxGeometry(Math.min(7, bw * 0.4), 0.9, 0.08),
                  new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.4 }),
                );
                rail.position.set(slab.position.x, by + 0.6, cz + face * (bd / 2 + 1.55));
                this.scene.add(rail);
              }
            }
            // Neon trim on some tall buildings.
            if (tall && rng() < 0.5) {
              const trimMat = new THREE.MeshStandardMaterial({
                color: pick(rng, [0xff5a7a, 0x39c2ff, 0xffd23f, 0x7affc4]),
                emissive: pick(rng, [0xff5a7a, 0x39c2ff, 0xffd23f, 0x7affc4]),
                emissiveIntensity: 0.9,
              });
              const trim = new THREE.Mesh(roofGeo, trimMat);
              trim.scale.set(bw + 0.3, 0.5, 0.6);
              trim.position.set(cx, h - 1.5, cz + bd / 2 + 0.1);
              this.scene.add(trim);
            }
            this.colliders.push({ x0: cx - bw / 2, z0: cz - bd / 2, x1: cx + bw / 2, z1: cz + bd / 2 });
            this.buildings.push({ x: cx, z: cz, w: bw, d: bd, h });
            placed++;
          }
        }
      }
    }
  }

  _buildPark(bx0, bz0, bx1, bz1) {
    const rng = this.rng;
    // Pond + benches + extra trees in park blocks.
    const pond = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 0.4, 20),
      new THREE.MeshStandardMaterial({ color: 0x3a8ab8, roughness: 0.2 }),
    );
    pond.position.set((bx0 + bx1) / 2, 0.2, (bz0 + bz1) / 2);
    this.scene.add(pond);
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1), benchMat);
      bench.position.set(bx0 + 8 + i * 12, 0.5, bz0 + 8);
      this.scene.add(bench);
    }
    this._plantTrees(rng, bx0, bz0, bx1, bz1, 6);
  }

  _buildPlaza(bx0, bz0, bx1, bz1) {
    // Central plaza: fountain + flag poles + open space (no colliders except fountain).
    const cx = (bx0 + bx1) / 2;
    const cz = (bz0 + bz1) / 2;
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6.5, 1, 20),
      new THREE.MeshStandardMaterial({ color: 0xc8b890, roughness: 0.7 }),
    );
    rim.position.set(cx, 0.5, cz);
    rim.castShadow = true;
    this.scene.add(rim);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 0.5, 20),
      new THREE.MeshStandardMaterial({ color: 0x4aa8d8, roughness: 0.15, metalness: 0.2 }),
    );
    water.position.set(cx, 0.9, cz);
    this.scene.add(water);
    const spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.8, 3.2, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.6 }),
    );
    spout.position.set(cx, 2.4, cz);
    this.scene.add(spout);
    this.colliders.push({ x0: cx - 6.5, z0: cz - 6.5, x1: cx + 6.5, z1: cz + 6.5 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 9, 8), poleMat);
      const px = cx + (i % 2 === 0 ? -14 : 14);
      const pz = cz + (i < 2 ? -14 : 14);
      pole.position.set(px, 4.5, pz);
      this.scene.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 1.8),
        new THREE.MeshStandardMaterial({ color: [0xff5a7a, 0x39c2ff, 0xffd23f, 0x7affc4][i], side: THREE.DoubleSide, roughness: 0.8 }),
      );
      flag.position.set(px + 1.6, 8, pz);
      this.scene.add(flag);
    }
  }

  _plantTrees(rng, x0, z0, x1, z1, n) {
    for (let i = 0; i < n; i++) {
      const x = rand(rng, x0 + 4, x1 - 4);
      const z = rand(rng, z0 + 4, z1 - 4);
      if (rng() < 0.5) this._addPalm(x, z, rand(rng, 0.85, 1.25));
      else this._addShadeTree(x, z, rand(rng, 0.9, 1.3));
    }
  }

  _addPalm(x, z, s) {
    // Palm: curved trunk (cylinder) + 6 fronds (flattened cones).
    const group = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.95 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.34 * s, 5.4 * s, 7), trunkMat);
    trunk.position.y = 2.7 * s;
    trunk.rotation.z = 0.08;
    trunk.castShadow = true;
    group.add(trunk);
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.85 });
    for (let i = 0; i < 6; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 3.4 * s, 4), frondMat);
      const a = (i / 6) * Math.PI * 2;
      frond.position.set(Math.cos(a) * 1.1 * s, 5.6 * s, Math.sin(a) * 1.1 * s);
      frond.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
      frond.castShadow = true;
      group.add(frond);
    }
    const coconut = new THREE.Mesh(
      new THREE.SphereGeometry(0.3 * s, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x6a4a22, roughness: 0.9 }),
    );
    coconut.position.y = 5.3 * s;
    group.add(coconut);
    group.position.set(x, 0, z);
    group.rotation.y = this.rng() * Math.PI * 2;
    this.scene.add(group);
  }

  _addShadeTree(x, z, s) {
    // Round-canopy street tree: trunk + three overlapping leaf spheres.
    const group = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 2.6 * s, 7), trunkMat);
    trunk.position.y = 1.3 * s;
    trunk.castShadow = true;
    group.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 0.85 });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x5a9a44, roughness: 0.85 });
    const blobs = [
      [0, 3.4, 0, 1.7, leafMat],
      [-0.9, 2.9, 0.3, 1.2, leafMat2],
      [0.9, 3.0, -0.2, 1.25, leafMat],
    ];
    for (const [bx, by, bz, r, m] of blobs) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * s, 10, 8), m);
      leaf.position.set(bx * s, by * s, bz * s);
      leaf.castShadow = true;
      group.add(leaf);
    }
    group.position.set(x, 0, z);
    group.rotation.y = this.rng() * Math.PI * 2;
    this.scene.add(group);
  }

  _buildProps() {
    const rng = this.rng;
    // Palms along the beach and scattered on sidewalks.
    for (let x = -260; x <= 260; x += 26) {
      this._addPalm(x + rand(rng, -4, 4), CITY_HALF + 8 + rand(rng, -2, 6), rand(rng, 0.9, 1.3));
    }
    for (let i = 0; i < 40; i++) {
      const road = pick(rng, ROAD_LINES);
      const along = rand(rng, -240, 240);
      const side = rng() < 0.5 ? -1 : 1;
      if (rng() < 0.5) this._addPalm(road + side * (ROAD_HALF + 2.5), along, rand(rng, 0.8, 1.1));
      else this._addPalm(along, road + side * (ROAD_HALF + 2.5), rand(rng, 0.8, 1.1));
    }
    // Shade trees along the main avenues.
    for (let i = 0; i < 24; i++) {
      const road = pick(rng, [-180, -60, 60, 180]);
      const along = rand(rng, -240, 240);
      const side = rng() < 0.5 ? -1 : 1;
      this._addShadeTree(road + side * (ROAD_HALF + 3.5), along, rand(rng, 0.9, 1.2));
    }
    // Streetlights along the main avenues.
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.6, roughness: 0.5 });
    const lampGeo = new THREE.SphereGeometry(0.45, 8, 6);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffe9a8, emissiveIntensity: 0.7 });
    const positions = [];
    for (const road of [-180, -60, 60, 180]) {
      for (let t = -240; t <= 240; t += 40) {
        positions.push([road + ROAD_HALF + 1.5, t]);
        positions.push([t, road + ROAD_HALF + 1.5]);
      }
    }
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, positions.length);
    const m = new THREE.Matrix4();
    positions.forEach(([x, z], i) => {
      m.makeTranslation(x, 3.5, z);
      poles.setMatrixAt(i, m);
      m.makeTranslation(x, 7.1, z);
      lamps.setMatrixAt(i, m);
    });
    poles.castShadow = false;
    this.scene.add(poles);
    this.scene.add(lamps);
    // Traffic lights at the four main intersections: pole, arm, 3-lamp head.
    const tlPoleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.5, roughness: 0.5 });
    const tlHeadMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6 });
    for (const rx of [-120, 0, 120]) {
      for (const rz of [-120, 0, 120]) {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6.4, 8), tlPoleMat);
        pole.position.y = 3.2;
        g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 3.4), tlPoleMat);
        arm.position.set(0, 6.2, -1.6);
        g.add(arm);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.4), tlHeadMat);
        head.position.set(0, 5.6, -3.2);
        g.add(head);
        const lampColors = [0xff2a1a, 0xffc81a, 0x2aff5a];
        for (let li = 0; li < 3; li++) {
          const lamp = new THREE.Mesh(
            new THREE.CircleGeometry(0.16, 10),
            new THREE.MeshStandardMaterial({
              color: lampColors[li],
              emissive: lampColors[li],
              emissiveIntensity: li === 2 ? 1.2 : 0.12,
            }),
          );
          lamp.position.set(0, 6.05 - li * 0.45, -3.42);
          lamp.rotation.y = Math.PI;
          g.add(lamp);
        }
        g.position.set(rx + ROAD_HALF + 1.2, 0, rz + ROAD_HALF + 1.2);
        g.rotation.y = Math.PI / 4;
        this.scene.add(g);
      }
    }
    // Bus stop shelters near the plaza and the Marina.
    for (const [bx, bz, rot] of [[-16, -8, 0], [170, 190, Math.PI / 2]]) {
      const shelter = new THREE.Group();
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.5, metalness: 0.3 });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 2.2), roofMat);
      roof.position.y = 2.6;
      shelter.add(roof);
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.5 });
      const back = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 0.08), glassMat);
      back.position.set(0, 1.4, 1);
      shelter.add(back);
      for (const px of [-2.8, 2.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), tlPoleMat);
        post.position.set(px, 1.3, 1);
        shelter.add(post);
      }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 0.8), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }));
      bench.position.set(0, 0.5, 0.6);
      shelter.add(bench);
      shelter.position.set(bx, 0, bz);
      shelter.rotation.y = rot;
      this.scene.add(shelter);
    }
    // Fire hydrants near intersections (small red cylinders).
    const hydGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.1, 8);
    const hydMat = new THREE.MeshStandardMaterial({ color: 0xc83228, roughness: 0.6 });
    const hyds = new THREE.InstancedMesh(hydGeo, hydMat, 24);
    for (let i = 0; i < 24; i++) {
      const rx = pick(rng, ROAD_LINES);
      const rz = pick(rng, ROAD_LINES);
      m.makeTranslation(rx + ROAD_HALF + 2, 0.55, rz + ROAD_HALF + 2);
      hyds.setMatrixAt(i, m);
    }
    this.scene.add(hyds);
  }

  // Is a point on a road (within the asphalt)?
  isOnRoad(x, z) {
    for (const r of ROAD_LINES) {
      if (Math.abs(x - r) < ROAD_HALF || Math.abs(z - r) < ROAD_HALF) return true;
    }
    return false;
  }

  // A random road position, optionally near (x, z).
  randomRoadPoint(rng, nearX = 0, nearZ = 0, minDist = 40, maxDist = 140) {
    for (let tries = 0; tries < 20; tries++) {
      const horizontal = rng() < 0.5;
      const road = pick(rng, ROAD_LINES);
      const along = rand(rng, -240, 240);
      const x = horizontal ? along : road;
      const z = horizontal ? road : along;
      const d = dist2d(x, z, nearX, nearZ);
      if (d >= minDist && d <= maxDist) return { x, z };
    }
    return { x: nearestRoadCoord(nearX), z: nearZ + 60 };
  }

  clampToCity(x, z, margin = 4) {
    return {
      x: clamp(x, -CITY_HALF - 30, CITY_HALF + 30),
      z: clamp(z, -CITY_HALF - 30, CITY_HALF + 34),
    };
  }
}
