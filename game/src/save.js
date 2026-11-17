// save.js — localStorage save slot for Solmar Bay. Plain JSON, versioned key.
// V2: saves are versioned (v2). A v1 save is migrated automatically: progress
// and stats are kept, and the fields v2 introduced get sensible defaults.
// Storage key: solmar-bay-save-v2 (legacy key: solmar-bay-save-v1).

const KEY = 'solmar-bay-save-v2';
const LEGACY_KEY = 'solmar-bay-save-v1';
const SAVE_VERSION = 2;

export function hasSave() {
  try {
    return !!(
      window.localStorage.getItem(KEY) || window.localStorage.getItem(LEGACY_KEY)
    );
  } catch {
    return false;
  }
}

export function saveGame(state) {
  try {
    const payload = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      money: state.money,
      health: state.health,
      ammo: state.ammo,
      missionIndex: state.missionIndex,
      missionsDone: state.missionsDone,
      player: { x: state.player.x, z: state.player.z, heading: state.player.heading },
      kills: state.kills || 0,
      carsStolen: state.carsStolen || 0,
      // V2: also remember the step inside the current mission.
      missionStep: state.missionStep || 0,
    };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.version === SAVE_VERSION) return data;
  // v1 -> v2: keep everything, add the new fields with defaults.
  return {
    ...data,
    version: SAVE_VERSION,
    missionStep: data.missionStep ?? 0,
    savedAt: data.savedAt ?? Date.now(),
  };
}

export function loadGame() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
    // Migrate a v1 save if one exists, and write it back under the v2 key.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    const data = migrate(JSON.parse(legacy));
    if (data) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        // storage full; the migrated data is still returned
      }
    }
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable; nothing to clear
  }
}

export { SAVE_VERSION };
