// input.js — keyboard + mouse state with edge detection for actions.
// V2: on-screen touch buttons for coarse pointers (phones/tablets) — a
// four-way move pad plus E (enter car), punch and jump — wired into the same
// key sets the keyboard uses, so the game logic never knows the difference.
// Written for Solmar Bay: Street Heat (make.fun gta6-01).

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, cleared each frame by endFrame()
    this.mouseDown = false;
    this.mouseDragX = 0;
    this.mouseDragY = 0;
    this.mouseClicked = false; // a press+release without much drag
    this._downX = 0;
    this._downY = 0;
    this._dragged = 0;
    this._touchButtons = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });

    canvas.addEventListener('pointerdown', (e) => {
      this.mouseDown = true;
      this._downX = e.clientX;
      this._downY = e.clientY;
      this._dragged = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.mouseDown) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this.mouseDragX += dx;
      this.mouseDragY += dy;
      this._dragged += Math.abs(dx) + Math.abs(dy);
    });
    window.addEventListener('pointerup', () => {
      if (this.mouseDown && this._dragged < 8) this.mouseClicked = true;
      this.mouseDown = false;
    });
    // Long-press on touch must not open the browser context menu mid-game.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Build the on-screen touch controls. Safe to call on desktop too — the
  // buttons stay hidden unless the device reports a coarse pointer.
  bindTouchButtons() {
    if (this._touchButtons) return this._touchButtons;
    // On-screen pause button (top-right, next to the wanted stars): feeds
    // the same KeyP the keyboard uses, so the existing pause handler fires.
    const pauseBtn = document.getElementById('hud-pause');
    if (pauseBtn) {
      const pDown = (e) => {
        e.preventDefault();
        this.keys.add('KeyP');
        this.pressed.add('KeyP');
      };
      const pUp = (e) => {
        e.preventDefault();
        this.keys.delete('KeyP');
      };
      pauseBtn.addEventListener('pointerdown', pDown);
      pauseBtn.addEventListener('pointerup', pUp);
      pauseBtn.addEventListener('pointerleave', pUp);
      pauseBtn.addEventListener('pointercancel', pUp);
    }
    // Layout and sizes live in index.html's stylesheet now (V2.1), so the
    // mobile media query can resize them instead of fixed inline styles.
    const wrap = document.createElement('div');
    wrap.id = 'touch-controls';
    const mkBtn = (label, code, opts = {}) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('aria-label', opts.aria || label);
      b.className = 'tbtn';
      if (opts.small) b.style.fontSize = '14px';
      const down = (e) => {
        e.preventDefault();
        if (code === 'CLICK') {
          this.mouseClicked = true;
          return;
        }
        this.keys.add(code);
        this.pressed.add(code);
      };
      const up = (e) => {
        e.preventDefault();
        if (code !== 'CLICK') this.keys.delete(code);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    // V2.1: a proper cross D-pad — four directions, EMPTY centre (V2 put
    // ▼ in the centre, which read as a stray button under the thumb).
    const pad = document.createElement('div');
    pad.id = 'touch-dpad';
    const cells = [
      null, mkBtn('▲', 'KeyW', { aria: 'Move forward' }), null,
      mkBtn('◀', 'KeyA', { aria: 'Move left' }), null, mkBtn('▶', 'KeyD', { aria: 'Move right' }),
      null, mkBtn('▼', 'KeyS', { aria: 'Move back' }), null,
    ];
    for (const c of cells) {
      if (c) {
        pad.appendChild(c);
      } else {
        const spacer = document.createElement('div');
        spacer.className = 'tbtn-spacer';
        pad.appendChild(spacer);
      }
    }
    wrap.appendChild(pad);
    // V2.1: one 2x2 action cluster — punch/fire, jump/handbrake, use/enter
    // car, run — the same keys the keyboard uses, so the game logic never
    // knows the difference. (V2 had no RUN button at all.)
    const actions = document.createElement('div');
    actions.id = 'touch-actions';
    actions.appendChild(mkBtn('👊', 'CLICK', { aria: 'Punch / fire' }));
    actions.appendChild(mkBtn('⤒', 'Space', { aria: 'Jump / handbrake' }));
    actions.appendChild(mkBtn('E', 'KeyE', { aria: 'Use / enter car' }));
    actions.appendChild(mkBtn('RUN', 'ShiftLeft', { aria: 'Run', small: true }));
    wrap.appendChild(actions);
    document.body.appendChild(wrap);
    this._touchButtons = wrap;
    this._updateTouchVisibility();
    window.matchMedia('(pointer: coarse)').addEventListener?.('change', () => this._updateTouchVisibility());
    return wrap;
  }

  _updateTouchVisibility() {
    if (!this._touchButtons) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this._touchButtons.style.display = coarse ? 'flex' : 'none';
  }

  // Show or hide the touch controls manually (main.js calls this on menu
  // open/close so the pad never covers the start screen).
  setVirtual(enabled) {
    if (!this._touchButtons) return;
    this._touchButtons.style.display = enabled && window.matchMedia('(pointer: coarse)').matches ? 'flex' : 'none';
  }

  down(code) {
    return this.keys.has(code);
  }

  // True once, on the frame the key went down.
  hit(code) {
    return this.pressed.has(code);
  }

  axis(positive, negative) {
    return (this.down(positive) ? 1 : 0) - (this.down(negative) ? 1 : 0);
  }

  // Call at the end of each frame.
  endFrame() {
    this.pressed.clear();
    this.mouseDragX = 0;
    this.mouseDragY = 0;
    this.mouseClicked = false;
  }
}
