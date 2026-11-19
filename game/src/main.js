// main.js — Solmar Bay: Street Heat. Bootstrap, game loop, camera, interactions,
// state machine (menu / playing / paused / busted / wasted / complete) and the
// debug handle window.__solmar used by play-tests. Written for make.fun gta6-01.

import * as THREE from 'three';
import { City, ROAD_LINES } from './city.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Player } from './player.js';
import { TrafficSystem, createCarState, stepCar } from './vehicles.js';
import { PedestrianSystem } from './pedestrians.js';
import { PoliceSystem } from './police.js';
import { CombatSystem } from './combat.js';
import { MissionSystem, MISSIONS } from './missions.js';
import { HUD } from './hud.js';
import { angleLerp, clamp, damp, dist2d, mulberry32 } from './utils.js';
import { clearSave, hasSave, loadGame, saveGame } from './save.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || '20261117');
const rng = mulberry32(seed);
const shotMode = params.get('shot') || null;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87bfe8);
scene.fog = new THREE.Fog(0x9fc4e8, 240, 760);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

// Sun + sky light. V2: a warmer late-afternoon sun, a cool blue fill from the
// opposite side so shadows are never pitch black, and a slightly higher
// exposure for richer colour.
const sun = new THREE.DirectionalLight(0xffe2b0, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160;
sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160;
sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x8ab8ff, 0.55);
fill.position.set(-120, 90, -60);
scene.add(fill);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a5a, 0.85);
scene.add(hemi);

const input = new Input(canvas);
input.bindTouchButtons();
const audio = new AudioEngine();
const hud = new HUD();
const city = new City(scene, rng);
const traffic = new TrafficSystem(scene, city, rng);
const parked = traffic.spawnParkedCars();
const peds = new PedestrianSystem(scene, city, rng);
const player = new Player(scene, city);
const police = new PoliceSystem(scene, city, rng);
const combat = new CombatSystem(scene, city, rng);
const missions = new MissionSystem(scene, city, city.landmarks);

const game = {
  state: 'menu', // menu | playing | paused | busted | wasted | complete
  money: 250,
  ammo: 24,
  kills: 0,
  carsStolen: 0,
  lastDamageAt: -99,
  time: 0,
  camYaw: Math.PI,
  camPitch: 0.34,
  camDist: 9,
  orbitYaw: 0,
  orbitPitch: 0,
  menuOrbit: 0,
  shotReady: false,
};

let playerCar = null; // car state when Danny owns/drives a car

missions.onEvent = (type, payload) => {
  if (type === 'mission-start') {
    hud.toast(payload.mission.intro, 6000);
    hud.setObjective(payload.mission.steps[0].text);
    hud.banner(payload.mission.title, payload.mission.intro, 4200);
    combat.clearThugs(); // fresh guards for this job, never duplicates
    if (payload.mission.id === 'the-score') spawnCashGuards(0);
    audio.jingle();
  } else if (type === 'step-complete') {
    audio.chime();
    const next = missions.currentStep();
    hud.toast(next ? 'Objective updated: ' + next.text : '', 4200);
    hud.setObjective(next ? next.text : '');
    if (missions.current() && missions.current().id === 'the-score' && next && next.cash !== undefined) {
      spawnCashGuards(next.cash);
    }
  } else if (type === 'radio') {
    // Mama Lou's radio chatter for the next step.
    hud.toast(payload.line, 5000);
  } else if (type === 'mission-complete') {
    game.money += payload.reward;
    game.ammo += 12;
    audio.jingle();
    hud.banner('JOB COMPLETE', payload.mission.outro + '  +$' + payload.reward, 5000);
    hud.toast('+$' + payload.reward + '  ·  +12 pistol rounds', 5000);
    hud.setObjective('');
    autosave();
    if (missions.isDone()) {
      setTimeout(() => {
        if (game.state === 'playing') {
          game.state = 'complete';
          hud.showMenu('complete', { start: resumeFromMenu });
        }
      }, 5200);
    } else {
      setTimeout(() => {
        if (game.state === 'playing') missions.startNext();
      }, 3800);
    }
  }
};

function spawnCashGuards(cashIndex) {
  const spot = city.landmarks.cashSpots[cashIndex];
  combat.spawnThugs(2, spot.x, spot.z);
  hud.toast('Vipers are guarding the drop — watch yourself.', 4000);
}

function autosave() {
  saveGame({
    money: game.money,
    health: player.health,
    ammo: game.ammo,
    missionIndex: missions.missionIndex,
    missionStep: missions.stepIndex,
    missionsDone: missions.done,
    player: { x: player.x, z: player.z, heading: player.heading },
    kills: game.kills,
    carsStolen: game.carsStolen,
  });
}

function applySave(data) {
  game.money = data.money;
  game.ammo = data.ammo;
  game.kills = data.kills || 0;
  game.carsStolen = data.carsStolen || 0;
  player.health = data.health;
  player.teleport(data.player.x, data.player.z, data.player.heading);
  missions.done = data.missionsDone || [false, false, false];
  missions.missionIndex = data.missionIndex || 0;
  missions.stepIndex = data.missionStep || 0;
}

function startPlaying(withStory) {
  hud.hideMenu();
  game.state = 'playing';
  audio.ensure();
  if (withStory) {
    if (missions.missionIndex < MISSIONS.length) missions.startNext();
  }
  hud.setObjective(missions.active && missions.currentStep() ? missions.currentStep().text : '');
}

function resumeFromMenu() {
  hud.hideMenu();
  game.state = 'playing';
  audio.ensure();
}

function showStartMenu() {
  game.state = 'menu';
  const saved = hasSave() ? loadGame() : null;
  hud.showMenu('start', {
    hasSave: saved,
    start: () => {
      clearSave();
      resetProgress();
      startPlaying(true);
    },
    continue: () => {
      if (saved) applySave(saved);
      startPlaying(missions.missionIndex < MISSIONS.length);
      // Resume inside the saved mission step, not back at step 0.
      if (saved && missions.active && missions.current()) {
        const steps = missions.current().steps.length;
        missions.stepIndex = Math.min(saved.missionStep || 0, steps - 1);
        missions._updateBeacon();
        hud.setObjective(missions.currentStep().text);
      }
    },
    freeroam: () => {
      resetProgress();
      startPlaying(false);
      hud.toast('Free roam — the city is yours. Steal a car, cause some heat.', 5000);
    },
  });
}

function resetProgress() {
  game.money = 250;
  game.ammo = 24;
  game.kills = 0;
  game.carsStolen = 0;
  player.health = 100;
  player.teleport(city.landmarks.louCorner.x, city.landmarks.louCorner.z + 8, Math.PI);
  if (playerCar) {
    scene.remove(playerCar.mesh.group);
    playerCar = null;
  }
  player.exitCar();
  police.clearWanted();
  combat.clearThugs();
  missions.missionIndex = 0;
  missions.stepIndex = 0;
  missions.done = [false, false, false];
  missions.active = false;
  missions.beacon.visible = false;
  missions.cashMarkers.forEach((g) => (g.visible = false));
  for (const p of parked) p.taken = false;
}

function handleBusted(reason) {
  if (game.state !== 'playing') return;
  game.state = 'busted';
  audio.busted();
  audio.setEngine(0, false);
  const fine = Math.min(game.money, Math.max(100, Math.round(game.money * 0.1)));
  game.money -= fine;
  police.clearWanted();
  if (player.car) {
    player.car.health = 100;
    player.exitCar();
  }
  player.health = 100;
  player.teleport(city.landmarks.hospital.x, city.landmarks.hospital.z + 6, 0);
  autosave();
  hud.showMenu('busted', { reason: reason + ' You lost $' + fine + ' in fines.', start: resumeFromMenu });
}

function handleWasted(reason) {
  if (game.state !== 'playing') return;
  game.state = 'wasted';
  audio.busted();
  audio.setEngine(0, false);
  const lost = Math.min(game.money, 100);
  game.money -= lost;
  police.clearWanted();
  if (player.car) {
    player.car.health = 100;
    player.exitCar();
  }
  player.health = 100;
  player.teleport(city.landmarks.hospital.x, city.landmarks.hospital.z + 6, 0);
  autosave();
  hud.showMenu('wasted', { reason: reason + ' The hospital patched you up. You lost $' + lost + '.', start: resumeFromMenu });
}

// ---- Interactions ----

function nearestParked(maxDist) {
  let best = null;
  let bd = maxDist;
  for (const p of parked) {
    if (p.taken) continue;
    const d = dist2d(player.x, player.z, p.x, p.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function nearestOwnedCar(maxDist) {
  if (!playerCar) return null;
  const d = dist2d(player.x, player.z, playerCar.x, playerCar.z);
  return d < maxDist ? playerCar : null;
}

function stealCar(parkedCar) {
  parkedCar.taken = true;
  const state = createCarState(parkedCar.x, parkedCar.z, parkedCar.heading, {
    maxSpeed: parkedCar.sports ? 38 : 29,
    accel: parkedCar.sports ? 19 : 14,
    color: parkedCar.color,
    sports: parkedCar.sports,
  });
  state.name = parkedCar.name;
  state.mesh = parkedCar.mesh;
  playerCar = state;
  player.enterCar(state);
  game.carsStolen += 1;
  audio.door();
  audio.chime();
  hud.toast('You stole the ' + parkedCar.name + '! The owner will notice.', 4000);
  police.addWanted(2, 'grand theft auto');
  if (missions.currentStep() && missions.currentStep().target === 'plazaCar' && parkedCar.name === 'Comet GT') {
    missions.plazaCarTaken();
    hud.toast('The cops are onto you — get to the chop shop!', 4500);
  }
  autosave();
}

function enterOwnedCar() {
  player.enterCar(playerCar);
  audio.door();
}

function updateInteractions(dt) {
  // Hint + E handling.
  let hint = '';
  if (player.onFoot) {
    const nearParked = nearestParked(4.5);
    const nearOwned = !nearParked ? nearestOwnedCar(4.5) : null;
    if (nearParked) {
      hint = '[E] Steal the ' + nearParked.name;
      if (input.hit('KeyE')) stealCar(nearParked);
    } else if (nearOwned) {
      hint = '[E] Get in your car';
      if (input.hit('KeyE')) enterOwnedCar();
    }
  } else if (input.hit('KeyE')) {
    player.exitCar();
    audio.door();
  }
  // Punch: click or F.
  if (player.onFoot && (input.mouseClicked || input.hit('KeyF'))) {
    if (player.tryPunch()) {
      audio.punch();
      const hit = combat.punch(player.x, player.z, player.heading);
      if (hit) hud.toast('Nice hit.', 1200);
      // Punching a pedestrian counts as assault.
      const ped = peds.nearest(player.x - Math.sin(player.heading) * 1.6, player.z - Math.cos(player.heading) * 1.6, 1.6);
      if (ped) {
        peds.remove(ped);
        police.addWanted(1, 'assault');
        hud.toast('You assaulted a pedestrian! The cops were called.', 3500);
      }
    }
  }
  // Shoot: Q, on foot only.
  if (player.onFoot && input.hit('KeyQ')) {
    if (game.ammo <= 0) {
      hud.toast('Out of ammo — finish a job to restock.', 3000);
    } else {
      game.ammo -= 1;
      audio.gunshot();
      const res = combat.shoot(player.x, player.z, player.heading, 1);
      if (res.hit === 'thug') {
        game.kills += 1;
        hud.toast('Viper down.', 1500);
      }
      police.addWanted(1, 'shots fired');
      // Nearby peds flee from the gunshot.
      const threats = [{ x: player.x, z: player.z, radius: 26 }];
      peds.update(0, threats);
    }
  }
  hud.setHint(hint);
}

// ---- Camera ----

function updateCamera(dt) {
  const focus = player.focusPoint();
  game.orbitYaw += input.mouseDragX * 0.005;
  game.orbitPitch = clamp(game.orbitPitch + input.mouseDragY * 0.003, -0.15, 0.55);
  const driving = !player.onFoot;
  // The chase shot pulls the camera back so the police behind the car stay
  // in frame. The drive shot pulls back further, so the road ahead reads as
  // an open road instead of a building filling the frame.
  // V2.1: the chase camera sits further back (dist 20 instead of 15) — the
  // cruisers trail 10-15 m behind the car, so at 15 m they sat on top of the
  // camera and only one (half cut off) was ever in frame. The wider angle
  // also reads the gaps between the cars instead of compressing them into a
  // bumper-to-bumper train. (The height here is governed by the fixed
  // camPitch below, not by a per-shot value — V2's targetHeight was dead
  // code and is removed.)
  const targetDist = driving ? (shotMode === 'chase' ? 20 : shotMode === 'drive' ? 17 : 12) : 8.5;
  // Frame-rate independent smoothing: the camera eases instead of snapping.
  game.camDist = damp(game.camDist, targetDist, 4, dt);
  // Camera yaw follows the focus heading, plus the mouse orbit offset.
  const desiredYaw = focus.heading + game.orbitYaw;
  game.camYaw = angleLerp(game.camYaw, desiredYaw, Math.min(1, dt * (driving ? 2.2 : 4)));
  const pitch = game.camPitch + game.orbitPitch;
  const dist = game.camDist;
  const cx = focus.x + Math.sin(game.camYaw) * dist * Math.cos(pitch);
  const cz = focus.z + Math.cos(game.camYaw) * dist * Math.cos(pitch);
  const cy = 1.6 + Math.sin(pitch) * dist + (driving ? 0.6 : 0.4);
  camera.position.set(cx, cy, cz);
  camera.lookAt(focus.x, 1.8, focus.z);
  // Sun shadow follows the player.
  sun.position.set(focus.x + 130, 190, focus.z + 70);
  sun.target.position.set(focus.x, 0, focus.z);
}

// ---- Shot presets (for screenshots) ----

function setupShot(mode) {
  // Shot staging only: move a traffic car far away on a distant road so it
  // can neither block the staged run nor wander into frame. Never runs in
  // normal play.
  let farSpot = -200;
  const moveTrafficAway = (t) => {
    t.horizontal = true;
    t.road = 180;
    t.lane = 3.4;
    t.dir = 1;
    t.heading = -Math.PI / 2;
    t.x = farSpot;
    t.z = 180 + 3.4;
    t.speed = 10;
    t.cruise = 10;
    t.stopped = 0;
    farSpot += 14;
  };
  game.state = 'playing';
  hud.hideMenu();
  audio.ensure();
  if (mode === 'cover') {
    // Danny on foot south of the plaza, facing north: fountain and skyline ahead.
    player.teleport(30, 44, 0);
    missions.startMission(0);
    game.camYaw = 0;
  } else if (mode === 'drive') {
    const comet = parked.find((p) => p.name === 'Comet GT' && p.x === 8);
    stealCar(comet);
    police.clearWanted();
    // Stage the car mid-block on the north-south road x = 120, heading
    // north, and clear its run: any traffic on that road ahead of the car,
    // or near the staging spot, is moved far away on a distant road, so the
    // shot shows the car cruising on the open road instead of rear-ending a
    // slower car and grinding to a halt. (Shot staging only; normal play is
    // untouched.) NOTE: the east-west roads used to be blocked by a
    // city-generation bug (count=2 buildings spilling onto the road below
    // their block) — fixed in V2.2, but this shot keeps the north-south
    // road, which photographs better with the sun behind the camera.
    const driveRoad = 120;
    for (const t of traffic.cars) {
      const onDriveRoad = !t.horizontal && t.road === driveRoad && t.z < 80;
      const nearStaging = Math.abs(t.x - driveRoad) < 45 && Math.abs(t.z - 60) < 45;
      if (onDriveRoad || nearStaging) moveTrafficAway(t);
    }
    player.car.x = driveRoad;
    player.car.z = 60;
    player.car.heading = 0;
    player.car.speed = 20;
    missions.startMission(0);
    game.camYaw = 0;
  } else if (mode === 'chase') {
    const comet = parked.find((p) => p.name === 'Comet GT' && p.x === 8);
    stealCar(comet);
    player.car.x = 0;
    player.car.z = -60;
    player.car.heading = 0;
    player.car.speed = 12;
    police.addWanted(3, 'chase');
    police.update(0.1, player, audio, () => {});
    police.update(0.1, player, audio, () => {});
    while (police.cruisers.length < 3) police._spawnCruiser(player.x, player.z);
    // Stage the cruisers staggered BEHIND the car (never ahead of it, so none
    // can U-turn head-on into the bumper), near the car's speed, so at capture
    // they are closing in with a clear gap instead of glued to the rear.
    // (Shot staging only; the chase/ram gameplay is untouched.)
    const stageSpots = [
      { x: -3.4, z: -50, speed: 21 },
      { x: 0, z: -48, speed: 20 },
      { x: 3.4, z: -46, speed: 20 },
    ];
    police.cruisers.forEach((c, i) => {
      const s = stageSpots[i % stageSpots.length];
      c.x = s.x;
      c.z = s.z;
      c.speed = s.speed;
    });
    // Clear the chase run on road x = 0, so traffic can't slow the player
    // car and let a cruiser glue itself to the bumper.
    for (const t of traffic.cars) {
      const onChaseRoad = !t.horizontal && t.road === 0 && t.z < -50 && t.z > -250;
      const nearChaseStaging = Math.abs(t.x) < 45 && Math.abs(t.z + 60) < 45;
      if (onChaseRoad || nearChaseStaging) moveTrafficAway(t);
    }
    // Staging only (shot mode never reaches normal play): start the car fast
    // and give it a big health buffer, so the scripted chase reads as a
    // chase in the screenshot instead of ending on the BUSTED screen — the
    // cruisers ram hard while the car is still slow, and the headless
    // renderer gives them two seconds of game time to do it in.
    player.car.speed = 26;
    player.car.health = 1000;
    missions.startMission(1);
    missions.stepIndex = 2; // deliver to the chop shop
    missions._updateBeacon();
    hud.setObjective(missions.currentStep().text);
    game.camYaw = 0;
    game.orbitYaw = 0.15;
  } else if (mode === 'mission') {
    // Danny on foot near the Marina cash drop, facing it and its Viper guards.
    const spot = city.landmarks.cashSpots[0];
    player.teleport(spot.x - 6, spot.z - 16, Math.atan2(-(spot.x - (spot.x - 6)), -(spot.z - (spot.z - 16))));
    missions.startMission(2);
    hud.setObjective(missions.currentStep().text);
    game.camYaw = player.heading;
  }
  game.shotReady = true;
}

// ---- Main loop ----

const clock = new THREE.Clock();
let hudTimer = 0;
let lastHealth = 100;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.time += dt;
  const playing = game.state === 'playing';
  // Touch controls only while actually playing.
  input.setVirtual(playing);
  hud.tickFlash(dt);

  if (playing) {
    // Driving or on foot.
    if (player.onFoot) {
      player.updateOnFoot(dt, input, game.camYaw);
      audio.setEngine(0, false);
      audio.setWind(0, false);
    } else if (player.car) {
      // In screenshot mode the car cruises on its own so the shot shows it moving.
      // In the chase shot it cruises slower, so the police catch up and stay in frame.
      const throttle = shotMode
        ? shotMode === 'chase'
          ? 0.45
          : 0.7
        : input.axis('KeyW', 'KeyS') || input.axis('ArrowUp', 'ArrowDown');
      const steer = input.axis('KeyD', 'KeyA') || input.axis('ArrowRight', 'ArrowLeft');
      const handbrake = input.down('Space');
      stepCar(player.car, { throttle, steer, handbrake }, dt, city, (s) => {
        audio.crash(Math.min(1, s / 22));
        if (s > 12) player.car.health -= (s - 12) * 0.9;
      });
      audio.setEngine(Math.abs(player.car.speed) / player.car.maxSpeed, true);
      audio.setWind(Math.abs(player.car.speed) / player.car.maxSpeed, true);
      // Hitting pedestrians with the car.
      if (Math.abs(player.car.speed) > 3) {
        const ped = peds.nearest(player.car.x, player.car.z, 2.3);
        if (ped) {
          peds.remove(ped);
          police.addWanted(1, 'hit pedestrian');
          audio.crash(0.8);
          hud.toast('You hit a pedestrian!', 3000);
        }
      }
      if (player.car.health <= 0) {
        handleBusted('Your car was wrecked.');
      }
    }
    updateInteractions(dt);
    traffic.update(dt, player.car, (s) => {
      if (s > 8) audio.crash(Math.min(1, s / 25));
    });
    const threats = [];
    if (player.car && Math.abs(player.car.speed) > 4) threats.push({ x: player.car.x, z: player.car.z, radius: 12 });
    peds.update(dt, threats);
    police.update(dt, player, audio, handleBusted);
    const wasted = combat.update(dt, player);
    if (wasted === 'wasted') handleWasted('The Vipers got the better of you.');
    // Damage flash + the damage clock for health regen (v1 never set it, so
    // regen was always on). A health drop also resets the 8 s regen timer.
    if (player.health < lastHealth) {
      hud.flashDamage(Math.min(1, (lastHealth - player.health) / 25 + 0.3));
      game.lastDamageAt = game.time;
    }
    lastHealth = player.health;
    missions.update(dt, player, game.time);
    // Health regen after 8s without damage.
    if (game.time - game.lastDamageAt > 8 && player.health > 0 && player.health < 100) {
      player.heal(2 * dt);
    }
    // Pause / mute.
    if (input.hit('KeyP') || input.hit('Escape')) {
      game.state = 'paused';
      autosave();
      hud.showMenu('paused', { start: resumeFromMenu, quit: () => showStartMenu() });
    }
    if (input.hit('KeyM')) audio.setMuted(!audio.muted);
    // Objective text follows the mission.
    if (missions.active && missions.currentStep()) {
      hud.setObjective(missions.currentStep().text);
    }
    // HUD refresh (10 Hz is enough for text).
    hudTimer += dt;
    if (hudTimer > 0.1) {
      hudTimer = 0;
      hud.setMoney(game.money);
      hud.setHealth(player.health);
      hud.setWanted(police.wanted);
      hud.setAmmo(game.ammo);
      hud.setSpeed(player.car ? Math.abs(player.car.speed) * 3.6 : 0, !!player.car);
      hud.drawMinimap({
        buildings: city.buildings,
        roads: ROAD_LINES,
        player: { x: player.x, z: player.z, heading: player.heading },
        traffic: traffic.cars.map((c) => ({ x: c.x, z: c.z, heading: c.heading })),
        police: [...police.positions().cruisers, ...police.positions().cops],
        thugs: combat.aliveThugs(),
        waypoint: missions.waypoint(),
        time: game.time,
      });
    }
  } else if (game.state === 'menu') {
    // Slow orbit around the plaza as the menu backdrop.
    game.menuOrbit += dt * 0.08;
    camera.position.set(Math.sin(game.menuOrbit) * 90, 42, Math.cos(game.menuOrbit) * 90);
    camera.lookAt(0, 12, 0);
    traffic.update(dt, null, null);
    peds.update(dt, []);
  }

  if (playing) updateCamera(dt);
  // Ocean shimmer.
  if (city.ocean) city.ocean.position.y = -0.15 + Math.sin(game.time * 0.7) * 0.06;
  renderer.render(scene, camera);
  input.endFrame();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// First user gesture unlocks audio.
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });
window.addEventListener('keydown', () => audio.ensure(), { once: true });

// Debug / play-test handle.
window.__solmar = {
  game,
  player,
  police,
  missions,
  combat,
  traffic,
  peds,
  parked,
  state() {
    return {
      state: game.state,
      money: game.money,
      ammo: game.ammo,
      health: player.health,
      wanted: police.wanted,
      onFoot: player.onFoot,
      inCar: !!player.car,
      carName: player.car ? player.car.name : null,
      carHealth: player.car ? player.car.health : null,
      carSpeed: player.car ? player.car.speed : 0,
      x: player.x,
      z: player.z,
      heading: player.heading,
      missionIndex: missions.missionIndex,
      missionStep: missions.stepIndex,
      missionActive: missions.active,
      missionDone: missions.done.slice(),
      objective: missions.active && missions.currentStep() ? missions.currentStep().text : '',
      thugsAlive: combat.aliveThugs().length,
      cruisers: police.cruisers.length,
      cops: police.cops.length,
      trafficCount: traffic.cars.length,
      pedsCount: peds.peds.length,
    };
  },
  startMission(i) {
    missions.startMission(i);
  },
  setWanted(n) {
    police.wanted = n;
    police.heat = 0;
  },
  teleport(x, z, h = 0) {
    player.teleport(x, z, h);
  },
  startPlaying(withStory = true) {
    startPlaying(withStory);
  },
  version: 'solmar-bay-2.0',
};

if (shotMode) {
  setupShot(shotMode);
} else {
  showStartMenu();
}
animate();
