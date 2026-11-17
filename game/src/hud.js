// hud.js — the 2D layer: health, money, wanted stars, mission objective, toasts,
// start/pause/busted screens, and a live canvas minimap. Written for Solmar Bay.
// V2: a red damage-flash overlay pulses whenever Danny is hurt (main.js calls
// flashDamage()), and the minimap now reads like a real map — parks in green,
// the plaza in sand, roads with a dark casing and lighter centre, traffic as
// small oriented car rectangles, cops as flashing dots.

import { clamp } from './utils.js';
import { CITY_HALF } from './city.js';

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.moneyEl = document.getElementById('hud-money');
    this.healthFill = document.getElementById('hud-health-fill');
    this.healthText = document.getElementById('hud-health-text');
    this.starsEl = document.getElementById('hud-stars');
    this.ammoEl = document.getElementById('hud-ammo');
    this.speedEl = document.getElementById('hud-speed');
    this.objectiveEl = document.getElementById('hud-objective');
    this.toastEl = document.getElementById('hud-toast');
    this.bannerEl = document.getElementById('hud-banner');
    this.bannerTitle = document.getElementById('hud-banner-title');
    this.bannerSub = document.getElementById('hud-banner-sub');
    this.minimap = document.getElementById('minimap');
    this.mm = this.minimap.getContext('2d');
    this.menuEl = document.getElementById('menu');
    this.menuTitle = document.getElementById('menu-title');
    this.menuStory = document.getElementById('menu-story');
    this.menuButtons = document.getElementById('menu-buttons');
    this.hintEl = document.getElementById('hud-hint');
    this._toastTimer = null;
    this._bannerTimer = null;
    this._lastToast = '';
    this._flashTimer = 0;
    // Damage flash overlay: a full-screen red vignette. Opacity is animated
    // by drawMinimap's caller via flashDamage() + the per-frame tick in
    // tickFlash(); main.js calls tickFlash(dt) every frame.
    this.flashEl = document.createElement('div');
    this.flashEl.id = 'damage-flash';
    Object.assign(this.flashEl.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      background: 'radial-gradient(ellipse at center, transparent 42%, rgba(255,20,20,0.55) 100%)',
      opacity: '0',
      zIndex: '30',
      transition: 'opacity 0.08s linear',
    });
    document.body.appendChild(this.flashEl);
  }

  // Called by main.js whenever Danny takes a hit; strength 0..1.
  flashDamage(strength = 1) {
    this._flashTimer = Math.max(this._flashTimer, 0.55 * strength);
    this.flashEl.style.opacity = String(Math.min(1, 0.5 + strength * 0.5));
  }

  // Fade the damage flash out; call once per frame.
  tickFlash(dt) {
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      this.flashEl.style.opacity = String(Math.max(0, this._flashTimer / 0.55));
    } else if (this.flashEl.style.opacity !== '0') {
      this.flashEl.style.opacity = '0';
    }
  }

  setMoney(n) {
    this.moneyEl.textContent = '$' + n.toLocaleString('en-US');
  }

  setHealth(h) {
    const pct = clamp(h, 0, 100);
    this.healthFill.style.width = pct + '%';
    this.healthFill.style.background = pct > 50 ? '#39d353' : pct > 25 ? '#e8b828' : '#e84a4a';
    this.healthText.textContent = Math.ceil(pct);
  }

  setWanted(n) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    this.starsEl.textContent = s;
    this.starsEl.classList.toggle('hot', n >= 3);
  }

  setAmmo(n) {
    this.ammoEl.textContent = n > 0 ? '🔫 ' + n : '🔫 —';
  }

  setSpeed(kmh, driving) {
    this.speedEl.textContent = driving ? Math.round(kmh) + ' km/h' : '';
  }

  setObjective(text) {
    this.objectiveEl.textContent = text || '';
    this.objectiveEl.style.display = text ? 'block' : 'none';
  }

  setHint(text) {
    this.hintEl.textContent = text || '';
  }

  toast(msg, ms = 4200) {
    if (msg === this._lastToast) return;
    this._lastToast = msg;
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.style.opacity = '0';
      this._lastToast = '';
    }, ms);
  }

  banner(title, sub, ms = 3600) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub || '';
    this.bannerEl.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.bannerEl.classList.remove('show'), ms);
  }

  showMenu(mode, callbacks) {
    // mode: 'start' | 'busted' | 'wasted' | 'complete' | 'paused'
    this.menuEl.classList.remove('hidden');
    this.menuButtons.innerHTML = '';
    const mkBtn = (label, fn, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = primary ? 'btn primary' : 'btn';
      b.addEventListener('click', fn);
      this.menuButtons.appendChild(b);
      return b;
    };
    if (mode === 'start') {
      this.menuTitle.textContent = 'SOLMAR BAY';
      this.menuStory.innerHTML =
        '<b>Street Heat.</b> You are Danny "D" Marlow, a driver-for-hire in the sun-soaked city of ' +
        'Solmar Bay. Mama Lou has three jobs for you — if you can handle the heat.<br><br>' +
        '<b>WASD</b> move / drive &nbsp;·&nbsp; <b>Shift</b> run &nbsp;·&nbsp; <b>E</b> steal / enter car &nbsp;·&nbsp; ' +
        '<b>Click</b> punch &nbsp;·&nbsp; <b>Q</b> shoot pistol &nbsp;·&nbsp; <b>Space</b> jump / handbrake &nbsp;·&nbsp; ' +
        '<b>Drag mouse</b> look around &nbsp;·&nbsp; <b>P</b> pause &nbsp;·&nbsp; <b>M</b> mute';
      mkBtn('▶  Start the story', callbacks.start, true);
      if (callbacks.hasSave) mkBtn('Continue ($' + callbacks.hasSave.money + ' saved)', callbacks.continue, false);
      mkBtn('Free roam', callbacks.freeroam, false);
    } else if (mode === 'busted') {
      this.menuTitle.textContent = 'BUSTED';
      this.menuStory.textContent = callbacks.reason || 'The Solmar Bay PD caught up with you.';
      mkBtn('Back on the street', callbacks.start, true);
    } else if (mode === 'wasted') {
      this.menuTitle.textContent = 'WASTED';
      this.menuStory.textContent = callbacks.reason || 'You got in over your head.';
      mkBtn('Back on the street', callbacks.start, true);
    } else if (mode === 'complete') {
      this.menuTitle.textContent = 'STORY COMPLETE';
      this.menuStory.textContent =
        'All three jobs done. Solmar Bay is yours, D. Free roam continues — keep the engine warm.';
      mkBtn('Keep playing', callbacks.start, true);
    } else if (mode === 'paused') {
      this.menuTitle.textContent = 'PAUSED';
      this.menuStory.textContent = 'The city waits for no one. Well — except now.';
      mkBtn('Resume', callbacks.start, true);
      mkBtn('Save & quit to menu', callbacks.quit, false);
    }
  }

  hideMenu() {
    this.menuEl.classList.add('hidden');
  }

  // Top-down map: roads, buildings, parks, plaza, beach, player, traffic,
  // police, waypoint. state: {buildings, roads, waypoint, traffic, thugs,
  // police, player, time}.
  drawMinimap(state) {
    const c = this.mm;
    const S = 200;
    const toPx = (v) => ((v + CITY_HALF + 40) / (CITY_HALF * 2 + 80)) * S;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(12,18,26,0.82)';
    c.fillRect(0, 0, S, S);
    // Parks in green, the central plaza in sand.
    c.fillStyle = '#2e5a28';
    c.fillRect(toPx(-150), toPx(120), toPx(-120) - toPx(-150), toPx(150) - toPx(120));
    c.fillRect(toPx(120), toPx(-150), toPx(150) - toPx(120), toPx(-120) - toPx(-150));
    c.fillStyle = '#8a7a52';
    c.fillRect(toPx(-30), toPx(-30), toPx(30) - toPx(-30), toPx(30) - toPx(-30));
    // Beach + water.
    c.fillStyle = '#e8d8a8';
    c.fillRect(0, toPx(CITY_HALF), S, S - toPx(CITY_HALF));
    c.fillStyle = '#2a7ab8';
    c.fillRect(0, toPx(CITY_HALF + 22), S, S - toPx(CITY_HALF + 22));
    // Blocks.
    c.fillStyle = '#5a6068';
    for (const b of state.buildings) {
      c.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), Math.max(2, toPx(b.x + b.w / 2) - toPx(b.x - b.w / 2)), Math.max(2, toPx(b.z + b.d / 2) - toPx(b.z - b.d / 2)));
    }
    // Roads: dark casing first, then a lighter asphalt centre line.
    for (const r of state.roads) {
      c.strokeStyle = '#1e2126';
      c.lineWidth = 8;
      c.beginPath();
      c.moveTo(toPx(r), 0);
      c.lineTo(toPx(r), S);
      c.stroke();
      c.beginPath();
      c.moveTo(0, toPx(r));
      c.lineTo(S, toPx(r));
      c.stroke();
      c.strokeStyle = '#3a3f47';
      c.lineWidth = 5.5;
      c.beginPath();
      c.moveTo(toPx(r), 0);
      c.lineTo(toPx(r), S);
      c.stroke();
      c.beginPath();
      c.moveTo(0, toPx(r));
      c.lineTo(S, toPx(r));
      c.stroke();
    }
    // Waypoint.
    if (state.waypoint) {
      const wx = toPx(state.waypoint.x);
      const wz = toPx(state.waypoint.z);
      const pulse = 5 + Math.sin(state.time * 5) * 2;
      c.fillStyle = '#39ff88';
      c.beginPath();
      c.moveTo(wx, wz - pulse);
      c.lineTo(wx + pulse, wz);
      c.lineTo(wx, wz + pulse);
      c.lineTo(wx - pulse, wz);
      c.closePath();
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1;
      c.stroke();
    }
    // Traffic: small car rectangles, oriented along their heading.
    for (const t of state.traffic) {
      c.save();
      c.translate(toPx(t.x), toPx(t.z));
      c.rotate(-(t.heading || 0));
      c.fillStyle = '#e8d878';
      c.fillRect(-1.5, -3, 3, 6);
      c.restore();
    }
    // Thugs.
    c.fillStyle = '#ff5a5a';
    for (const t of state.thugs) {
      c.beginPath();
      c.arc(toPx(t.x), toPx(t.z), 2.5, 0, Math.PI * 2);
      c.fill();
    }
    // Police (flashing).
    const flash = Math.floor(state.time * 4) % 2 === 0;
    c.fillStyle = flash ? '#3a6aff' : '#ff3a3a';
    for (const p of state.police) {
      c.beginPath();
      c.arc(toPx(p.x), toPx(p.z), 3.5, 0, Math.PI * 2);
      c.fill();
    }
    // Player arrow.
    const px = toPx(state.player.x);
    const pz = toPx(state.player.z);
    c.save();
    c.translate(px, pz);
    c.rotate(-state.player.heading + Math.PI);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();
    // North marker.
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.font = 'bold 11px sans-serif';
    c.fillText('N', S - 14, 14);
  }
}
