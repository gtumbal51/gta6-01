// missions.js — the story of Solmar Bay: three jobs for Mama Lou, each a chain of
// objectives with a 3D beacon, dialogue, and a cash reward. Written for Solmar Bay.

import * as THREE from 'three';
import { dist2d } from './utils.js';

export const MISSIONS = [
  {
    id: 'first-run',
    title: 'Job 1 — The First Run',
    intro: 'Mama Lou needs a driver she can trust. Meet her at the corner of 4th & Marlin.',
    steps: [
      {
        text: 'Meet Mama Lou at the corner of 4th & Marlin',
        target: 'louCorner',
        radius: 4,
        radio: 'Lou: "You\'re late, kid. Don\'t make me regret calling you."',
      },
      {
        text: 'Drive to the Docks and pick up the package',
        target: 'docks',
        radius: 5,
        radio: 'Lou: "Package is at the Docks, Pier 9. No peeking, no questions."',
      },
      {
        text: 'Deliver the package to the garage on Coral Row',
        target: 'garage',
        radius: 5,
        radio: 'Lou: "Garage on Coral Row. Knock twice, hand it over, walk away."',
      },
    ],
    reward: 500,
    outro: 'Clean run, kid. Lou remembers who shows up.',
  },
  {
    id: 'hot-wheels',
    title: 'Job 2 — Hot Wheels',
    intro: 'A red Comet GT is parked by the plaza. Bring it to the chop shop — fast, and loud.',
    steps: [
      {
        text: 'Find the red Comet GT parked by the plaza',
        target: 'plaza',
        radius: 12,
        radio: 'Lou: "Red Comet GT, parked by the plaza. The owner won\'t miss it. Probably."',
      },
      {
        text: 'Steal the Comet GT (E to get in)',
        target: 'plazaCar',
        radius: 5,
        needCar: 'Comet GT',
        radio: 'Lou: "That\'s the one. Get in, get gone — the cops love a show."',
      },
      {
        text: 'Lose the cops and deliver it to the chop shop',
        target: 'chopShop',
        radius: 6,
        needCar: 'Comet GT',
        radio: 'Lou: "Chop shop, north end. Lose the heat first or you\'re bringing them with you."',
      },
    ],
    reward: 800,
    outro: 'The GT is gone before the owner finished his coffee. Nice.',
  },
  {
    id: 'the-score',
    title: 'Job 3 — The Score',
    intro: 'Three cash drops are stashed around the city. The Vipers are watching them. Take all three.',
    steps: [
      {
        text: 'Grab the cash drop at the Marina (watch for Vipers)',
        target: 'cash0',
        radius: 4,
        cash: 0,
        radio: 'Lou: "First drop\'s at the Marina. Vipers are watching it — hit fast."',
      },
      {
        text: 'Grab the cash drop at Coral Row',
        target: 'cash1',
        radius: 4,
        cash: 1,
        radio: 'Lou: "Second drop, Coral Row. Don\'t let them box you in."',
      },
      {
        text: 'Grab the cash drop at Northgate',
        target: 'cash2',
        radius: 4,
        cash: 2,
        radio: 'Lou: "Last one, Northgate. Grab it and run — the drop-off is waiting."',
      },
      {
        text: 'Deliver the haul to the drop-off on Coral Row',
        target: 'dropOff',
        radius: 5,
        radio: 'Lou: "Bring it all home, D. Coral Row drop-off. Then we\'re even."',
      },
    ],
    reward: 1500,
    outro: 'Three drops, no witnesses. Solmar Bay is yours now, D.',
  },
];

export class MissionSystem {
  constructor(scene, city, landmarks) {
    this.scene = scene;
    this.city = city;
    this.landmarks = landmarks;
    this.missionIndex = 0;
    this.stepIndex = 0;
    this.active = false;
    this.done = [false, false, false];
    this.beacon = this._makeBeacon();
    this.cashMarkers = [];
    this._makeCashMarkers();
    this.beacon.visible = false;
    this.onEvent = null; // (type, payload) => void, wired by main.js
  }

  _makeBeacon() {
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.4, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 30;
    group.add(beam);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.22, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x39ff88 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    group.add(ring);
    // Outer guide ring: wider, fainter, slowly rotating — visible from afar.
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 0.12, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.45 }),
    );
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = 0.25;
    group.add(outerRing);
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1),
      new THREE.MeshBasicMaterial({ color: 0xffe94a }),
    );
    diamond.position.y = 6;
    diamond.userData.isDiamond = true;
    group.add(diamond);
    group.userData.diamond = diamond;
    group.userData.ring = ring;
    group.userData.outerRing = outerRing;
    this.scene.add(group);
    return group;
  }

  _makeCashMarkers() {
    for (const spot of this.landmarks.cashSpots) {
      const group = new THREE.Group();
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.7, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x2a6a2a, roughness: 0.7 }),
      );
      bag.position.y = 0.5;
      bag.castShadow = true;
      group.add(bag);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(1.14, 0.2, 0.54),
        new THREE.MeshStandardMaterial({ color: 0xe8d878, roughness: 0.4, metalness: 0.4 }),
      );
      band.position.y = 0.5;
      group.add(band);
      const glow = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.7),
        new THREE.MeshBasicMaterial({ color: 0xffe94a }),
      );
      glow.position.y = 2.2;
      group.add(glow);
      group.userData.glow = glow;
      group.position.set(spot.x, 0, spot.z);
      group.visible = false;
      this.scene.add(group);
      this.cashMarkers.push(group);
    }
  }

  current() {
    return MISSIONS[this.missionIndex] || null;
  }

  currentStep() {
    const m = this.current();
    if (!m) return null;
    return m.steps[this.stepIndex] || null;
  }

  startMission(index) {
    this.missionIndex = index;
    this.stepIndex = 0;
    this.active = true;
    this._updateBeacon();
    const m = this.current();
    if (m && this.onEvent) this.onEvent('mission-start', { mission: m });
  }

  startNext() {
    if (this.missionIndex >= MISSIONS.length) {
      this.active = false;
      this.beacon.visible = false;
      return false;
    }
    this.startMission(this.missionIndex);
    return true;
  }

  targetPos(step) {
    const L = this.landmarks;
    switch (step.target) {
      case 'louCorner': return L.louCorner;
      case 'docks': return L.docks;
      case 'garage': return L.garage;
      case 'plaza': return L.plaza;
      case 'plazaCar': return { x: 8, z: 4 };
      case 'chopShop': return L.chopShop;
      case 'dropOff': return L.dropOff;
      case 'cash0': return L.cashSpots[0];
      case 'cash1': return L.cashSpots[1];
      case 'cash2': return L.cashSpots[2];
      default: return L.plaza;
    }
  }

  _updateBeacon() {
    const step = this.currentStep();
    if (!step || !this.active) {
      this.beacon.visible = false;
      return;
    }
    const p = this.targetPos(step);
    this.beacon.position.set(p.x, 0, p.z);
    this.beacon.visible = true;
    // Show the matching cash marker.
    this.cashMarkers.forEach((g, i) => {
      g.visible = step.cash === i;
    });
  }

  // Called every frame; returns an event string when a step completes.
  update(dt, player, time) {
    if (!this.active) return null;
    // Animate the beacon.
    if (this.beacon.visible) {
      const d = this.beacon.userData.diamond;
      d.rotation.y += dt * 2;
      d.position.y = 6 + Math.sin(time * 2.2) * 0.8;
      const pulse = 1 + Math.sin(time * 3) * 0.08;
      this.beacon.userData.ring.scale.set(pulse, pulse, 1);
      const outer = this.beacon.userData.outerRing;
      if (outer) {
        outer.rotation.z += dt * 0.4;
        const op = 1 + Math.sin(time * 3) * 0.15;
        outer.scale.set(op, op, 1);
      }
    }
    for (const g of this.cashMarkers) {
      if (g.visible) {
        g.userData.glow.rotation.y += dt * 3;
        g.userData.glow.position.y = 2.2 + Math.sin(time * 2.5) * 0.4;
      }
    }
    const step = this.currentStep();
    if (!step) return null;
    const p = this.targetPos(step);
    // The focus point is the car when Danny is driving, Danny himself on foot.
    const fp = player.focusPoint();
    const d = dist2d(fp.x, fp.z, p.x, p.z);
    if (step.needCar && !(player.car && player.car.name === step.needCar)) {
      return null; // must be in the right car
    }
    if (d < step.radius) {
      return this._advance();
    }
    return null;
  }

  _advance() {
    const m = this.current();
    const step = this.currentStep();
    this.stepIndex += 1;
    if (this.stepIndex >= m.steps.length) {
      this.done[this.missionIndex] = true;
      this.active = false;
      this.beacon.visible = false;
      this.cashMarkers.forEach((g) => (g.visible = false));
      const reward = m.reward;
      const finishedIndex = this.missionIndex;
      this.missionIndex += 1;
      if (this.onEvent) this.onEvent('mission-complete', { mission: m, reward, index: finishedIndex });
      return 'mission-complete';
    }
    this._updateBeacon();
    // Radio chatter from Mama Lou for the new step.
    const next = this.currentStep();
    if (this.onEvent) {
      if (next && next.radio) this.onEvent('radio', { line: next.radio });
      this.onEvent('step-complete', { mission: m, step });
    }
    return 'step-complete';
  }

  // The plaza step of Job 2 completes when Danny gets into the Comet GT.
  plazaCarTaken() {
    const step = this.currentStep();
    if (this.active && step && step.target === 'plazaCar') {
      return this._advance();
    }
    return null;
  }

  waypoint() {
    const step = this.currentStep();
    if (!step || !this.active) return null;
    return this.targetPos(step);
  }

  isDone() {
    return this.missionIndex >= MISSIONS.length;
  }
}
