/* ===== js/physics.js ===== */
// physics.js
// Saare physics aur circuit ke formulas yahan hain. Is file mein DOM / HTML kuch nahi hai
// (pure JavaScript), isliye isko Node mein bhi test kar sakte hain (tests/ folder dekho).
//
// Models "ideal" hain: perfect battery, perfect wires, koi air resistance nahi.

const Physics = {
  // Default gravity (m/s^2)
  G_EARTH: 9.81,

  // ---------- Circuit basics ----------

  // Series: R_total = R1 + R2 + ...
  seriesResistance(ohmsList) {
    return ohmsList.reduce((sum, r) => sum + r, 0);
  },

  // Parallel: 1/R_total = 1/R1 + 1/R2 + ...
  parallelResistance(ohmsList) {
    const sumOfInverses = ohmsList.reduce((sum, r) => sum + 1 / r, 0);
    return 1 / sumOfInverses;
  },

  // Ohm's law: I = V / R
  current(volts, ohms) {
    return volts / ohms;
  },

  // Power: P = V * I
  power(volts, amps) {
    return volts * amps;
  },

  // Circuit solver.
  // model = {
  //   hasBattery, voltage, topology: 'series' | 'parallel',
  //   switchPresent, switchClosed,
  //   resistors: [{ id, label, ohms, connected }],
  //   wireCount            (0-ohm wires)
  // }
  // Returns { status, message, warnings, totalResistance, current, voltage, power, parts }
  // status: 'empty' | 'invalid' | 'open' | 'short' | 'partial' | 'ok'
  // Jab status ok/partial nahi hota to numbers null hote hain (galat number nahi dikhate).
  solveCircuit(model) {
    const bad = (status, message) => ({
      status, message, warnings: [],
      totalResistance: null, current: null, voltage: null, power: null, parts: [],
    });
    const OPEN_MESSAGE =
      'The circuit is not closed, so no current flows. Close the switch or connect the wires.';

    // 1. Battery hai ya nahi
    if (!model.hasBattery) {
      return bad('empty', 'No battery yet. Add a battery from the palette to start.');
    }

    // 2. Values sahi hain ya nahi
    if (!(model.voltage > 0) || !isFinite(model.voltage)) {
      return bad('invalid', 'Battery voltage must be greater than 0 volts.');
    }
    for (const r of model.resistors) {
      if (!(r.ohms > 0) || !isFinite(r.ohms)) {
        return bad('invalid', 'Resistance must be greater than 0 ohms. Check ' + r.label + '.');
      }
    }

    // 3. Switch open hai to current nahi behta
    if (model.switchPresent && !model.switchClosed) {
      return bad('open', OPEN_MESSAGE);
    }

    const connected = model.resistors.filter((r) => r.connected);
    const loose = model.resistors.filter((r) => !r.connected);
    const warnings = [];

    if (model.topology === 'series') {
      // Series mein ek bhi tooti wire = poora circuit open
      if (loose.length > 0) return bad('open', OPEN_MESSAGE);
      // Koi resistor nahi => battery seedha wire se judi hai = short circuit
      if (connected.length === 0) {
        return bad('short',
          'Short circuit: the battery is connected with no resistance in the path, so the current would be dangerously large. Add a resistor.');
      }
      const total = Physics.seriesResistance(connected.map((r) => r.ohms));
      const amps = Physics.current(model.voltage, total);
      return {
        status: 'ok', message: 'Circuit is closed. Readings are live.', warnings,
        totalResistance: total, current: amps, voltage: model.voltage,
        power: Physics.power(model.voltage, amps),
        parts: connected.map((r) => ({
          id: r.id, label: r.label, ohms: r.ohms, connected: true,
          voltageDrop: amps * r.ohms, current: amps, power: amps * amps * r.ohms,
        })),
      };
    }

    // ---- Parallel ----
    // Wire branch (0 ohm) battery ko short kar deti hai
    if (model.wireCount > 0) {
      return bad('short',
        'Short circuit: a plain wire branch has no resistance, so the current would be dangerously large. Remove the wire or add a resistor in that branch.');
    }
    if (connected.length === 0) return bad('open', OPEN_MESSAGE);

    const branchCurrents = connected.map((r) => model.voltage / r.ohms);
    const totalCurrent = branchCurrents.reduce((sum, i) => sum + i, 0);
    const parts = model.resistors.map((r) => {
      if (!r.connected) {
        return { id: r.id, label: r.label, ohms: r.ohms, connected: false,
          voltageDrop: 0, current: 0, power: 0 };
      }
      const amps = model.voltage / r.ohms;
      return { id: r.id, label: r.label, ohms: r.ohms, connected: true,
        voltageDrop: model.voltage, current: amps, power: model.voltage * amps };
    });
    loose.forEach((r) => {
      warnings.push(r.label + ' is not connected, so it is left out of the readings. Tick "Wire connected" to include it.');
    });
    return {
      status: loose.length > 0 ? 'partial' : 'ok',
      message: loose.length > 0
        ? 'Showing readings for the connected part only.'
        : 'Circuit is closed. Readings are live.',
      warnings,
      totalResistance: model.voltage / totalCurrent,
      current: totalCurrent, voltage: model.voltage,
      power: Physics.power(model.voltage, totalCurrent),
      parts,
    };
  },

  // ---------- Projectile motion (ground se ground tak, no air resistance) ----------

  toRadians(deg) {
    return (deg * Math.PI) / 180;
  },

  // Range R = v^2 * sin(2 theta) / g
  projectileRange(speed, angleDeg, g) {
    return (speed * speed * Math.sin(2 * Physics.toRadians(angleDeg))) / g;
  },

  // Time of flight T = 2 v sin(theta) / g
  projectileTimeOfFlight(speed, angleDeg, g) {
    return (2 * speed * Math.sin(Physics.toRadians(angleDeg))) / g;
  },

  // Max height H = (v sin(theta))^2 / (2 g)
  projectileMaxHeight(speed, angleDeg, g) {
    const vy = speed * Math.sin(Physics.toRadians(angleDeg));
    return (vy * vy) / (2 * g);
  },

  // Position at time t (animation ke liye)
  projectilePosition(speed, angleDeg, g, t) {
    const a = Physics.toRadians(angleDeg);
    return {
      x: speed * Math.cos(a) * t,
      y: speed * Math.sin(a) * t - 0.5 * g * t * t,
    };
  },

  // "Measured" values: chhote time steps mein step-by-step simulation chalate hain
  // aur formula se compare karte hain. Ground cross hone par linear interpolation.
  simulateProjectile(speed, angleDeg, g, dt = 0.0005) {
    const a = Physics.toRadians(angleDeg);
    let x = 0, y = 0, t = 0, maxY = 0;
    let vx = speed * Math.cos(a);
    let vy = speed * Math.sin(a);
    for (let i = 0; i < 2000000; i++) {
      const nextVy = vy - g * dt;
      const nextX = x + vx * dt;
      const nextY = y + (vy + nextVy) / 2 * dt; // average velocity: accurate for constant g
      if (nextY < 0 && i > 0) {
        const fraction = y / (y - nextY); // ground tak kitna step
        return {
          range: x + (nextX - x) * fraction,
          timeOfFlight: t + dt * fraction,
          maxHeight: maxY,
        };
      }
      x = nextX; y = nextY; vy = nextVy; t += dt;
      if (y > maxY) maxY = y;
    }
    return { range: x, timeOfFlight: t, maxHeight: maxY };
  },

  // ---------- Simple pendulum ----------

  // Theory (small angle): T = 2 pi sqrt(L / g)
  pendulumPeriodTheory(length, g) {
    return 2 * Math.PI * Math.sqrt(length / g);
  },

  // Pendulum equation: theta'' = -(g/L) sin(theta). RK4 se step-by-step solve karte hain.
  // Returns { period, samples } ; samples = array of angles (radians) har dt par.
  simulatePendulum(length, startAngleDeg, g, dt = 0.001, durationSeconds = 0) {
    const accel = (theta) => -(g / length) * Math.sin(theta);
    let theta = Physics.toRadians(startAngleDeg);
    let omega = 0;
    let t = 0;
    let period = null;
    const samples = [theta];
    const maxTime = Math.max(durationSeconds, 0);
    // Safety limit: bahut lamba loop na chale
    for (let i = 0; i < 3000000; i++) {
      const k1t = omega,              k1w = accel(theta);
      const k2t = omega + 0.5 * dt * k1w, k2w = accel(theta + 0.5 * dt * k1t);
      const k3t = omega + 0.5 * dt * k2w, k3w = accel(theta + 0.5 * dt * k2t);
      const k4t = omega + dt * k3w,   k4w = accel(theta + dt * k3t);
      const newTheta = theta + (dt / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
      const newOmega = omega + (dt / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
      // Pehli baar jab angle 0 cross kare = quarter period. Period = 4 x quarter.
      if (period === null && theta > 0 && newTheta <= 0) {
        const fraction = theta / (theta - newTheta);
        period = 4 * (t + dt * fraction);
      }
      theta = newTheta; omega = newOmega; t += dt;
      if (maxTime > 0) samples.push(theta);
      if (period !== null && t >= maxTime) break;
    }
    return { period, samples };
  },

  // ---------- Comparison ----------

  // Percent difference = |measured - theory| / theory * 100
  percentDifference(measured, theory) {
    if (theory === 0) return 0;
    return (Math.abs(measured - theory) / Math.abs(theory)) * 100;
  },

  // Status: tolerance ke andar => Matched, warna Needs repeat
  statusFromDifference(diffPercent, tolerancePercent) {
    return diffPercent <= tolerancePercent ? 'Matched' : 'Needs repeat';
  },
};

// Node (tests) ke liye export. Browser mein ye line skip ho jati hai.
if (typeof module !== 'undefined' && module.exports) module.exports = Physics;


/* ===== js/validation.js ===== */
// validation.js
// Input check karne ke functions (pure JS, tests mein bhi use hote hain).
// Har function { ok, value, message } return karta hai.
// Messages friendly hain: kya galat hua + kya karna hai.

const Validation = {
  // Text ko number mein badlo. Khali ya galat text => NaN
  toNumber(text) {
    if (text === null || text === undefined) return NaN;
    const cleaned = String(text).trim();
    if (cleaned === '') return NaN;
    return Number(cleaned);
  },

  // Generic range check.
  // options: { label, unit, min, max, minExclusive }
  validateNumber(text, options) {
    const { label, unit = '', min = -Infinity, max = Infinity, minExclusive = false } = options;
    const value = Validation.toNumber(text);
    const unitText = unit ? ' ' + unit : '';
    if (Number.isNaN(value) || !isFinite(value)) {
      return { ok: false, value: NaN, message: label + ' must be a number. Type a value like 5.' };
    }
    const tooLow = minExclusive ? value <= min : value < min;
    if (tooLow || value > max) {
      let rule;
      if (min !== -Infinity && max !== Infinity) {
        rule = (minExclusive ? 'greater than ' : 'at least ') + min + unitText + ' and at most ' + max + unitText;
      } else if (min !== -Infinity) {
        rule = (minExclusive ? 'greater than ' : 'at least ') + min + unitText;
      } else {
        rule = 'at most ' + max + unitText;
      }
      return { ok: false, value, message: label + ' must be ' + rule + '.' };
    }
    return { ok: true, value, message: '' };
  },

  // Resistance: PRD ka exact message "Resistance must be greater than 0 ohms."
  validateResistance(text) {
    const result = Validation.validateNumber(text, {
      label: 'Resistance', unit: 'ohms', min: 0, max: 1000000, minExclusive: true,
    });
    if (!result.ok && result.value <= 0) {
      return { ok: false, value: result.value, message: 'Resistance must be greater than 0 ohms.' };
    }
    return result;
  },

  validateVoltage(text) {
    return Validation.validateNumber(text, {
      label: 'Battery voltage', unit: 'V', min: 0, max: 100, minExclusive: true,
    });
  },

  validateSpeed(text) {
    return Validation.validateNumber(text, {
      label: 'Launch speed', unit: 'm/s', min: 0, max: 100, minExclusive: true,
    });
  },

  validateAngle(text) {
    return Validation.validateNumber(text, {
      label: 'Launch angle', unit: 'degrees', min: 1, max: 89,
    });
  },

  validateLength(text) {
    return Validation.validateNumber(text, {
      label: 'Pendulum length', unit: 'm', min: 0, max: 5, minExclusive: true,
    });
  },

  validatePendulumAngle(text) {
    return Validation.validateNumber(text, {
      label: 'Start angle', unit: 'degrees', min: 1, max: 80,
    });
  },

  // Result ka naam: khali nahi, max 60 characters
  validateName(text) {
    const name = String(text || '').trim();
    if (name === '') {
      return { ok: false, value: '', message: 'Please give your result a name, for example "My first circuit".' };
    }
    if (name.length > 60) {
      return { ok: false, value: name, message: 'Name must be 60 characters or fewer.' };
    }
    return { ok: true, value: name, message: '' };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = Validation;


/* ===== js/utils.js ===== */
// utils.js
// Chhote helper functions (pure JS): number formatting, HTML escape, CSV banana.

const Utils = {
  // Number ko readable banao: 1.2 -> "1.2", 6 -> "6", 0.333333 -> "0.333"
  formatNumber(value, decimals = 3) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return String(parseFloat(Number(value).toFixed(decimals)));
  },

  // Value + unit: formatWithUnit(1.2, 'A') -> "1.2 A"
  formatWithUnit(value, unit, decimals = 3) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return Utils.formatNumber(value, decimals) + ' ' + unit;
  },

  // User ka text HTML mein dalne se pehle escape karo (safe rehne ke liye)
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // Ek CSV cell banao. Comma/quote/newline ho to quotes lagao.
  // Agar text = + - @ se shuru ho to Excel formula na samjhe, isliye aage ' lagate hain.
  csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) text = "'" + text;
    if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  },

  // headers = ['Name','Type'], rows = [['a','b'], ...]
  toCsv(headers, rows) {
    const lines = [headers.map(Utils.csvCell).join(',')];
    rows.forEach((row) => lines.push(row.map(Utils.csvCell).join(',')));
    return lines.join('\r\n');
  },

  // Theme ka rang CSS variable se padho, e.g. Utils.themeColor('--accent', '#00f0ff').
  // Drawings (SVG strings) har baar draw hote waqt ye call karti hain, isliye theme badalte hi naya rang aata hai.
  // Ek theme ke liye values cache hoti hain (animation mein har frame getComputedStyle nahi chalta).
  _themeCache: { theme: null, values: {} },
  themeColor(name, fallback) {
    const fb = fallback || '#00f0ff';
    if (typeof document === 'undefined' || !document.documentElement || typeof getComputedStyle !== 'function') return fb;
    try {
      const root = document.documentElement;
      const theme = root.getAttribute('data-theme') || '';
      const cache = Utils._themeCache;
      if (cache.theme !== theme) { cache.theme = theme; cache.values = {}; }
      if (!(name in cache.values)) cache.values[name] = getComputedStyle(root).getPropertyValue(name).trim();
      return cache.values[name] || fb;
    } catch (e) {
      return fb;
    }
  },

  // Theme badalne par cache saaf karo
  clearThemeCache() {
    Utils._themeCache = { theme: null, values: {} };
  },

  // Unique id: prefix + time + random
  makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = Utils;


/* ===== js/themeManager.js ===== */
// themeManager.js
// Colour theme (green / cyan / pink): choose, remember, apply.
// - Choice is saved in localStorage under "vlab-theme" (inside try/catch, so a blocked storage is fine).
// - <head> has a tiny inline script that sets html[data-theme] before first paint; this file does the rest.
// - On a change it sets data-theme, updates the swatch buttons and fires a "themechange" event on document.
//   the simulator drawings listen to that event and redraw with the new CSS variables.
// Loaded after utils.js and before the simulators / app.js.

const ThemeManager = {
  KEY: 'vlab-theme',
  THEMES: ['green', 'cyan', 'pink'],
  DEFAULT: 'cyan',

  // Kuch bhi aaye, valid theme naam hi wapas do
  normalize(value) {
    return ThemeManager.THEMES.indexOf(value) >= 0 ? value : ThemeManager.DEFAULT;
  },

  // Saved choice padho (storage band ho ya kharab value ho to default)
  load(storage) {
    try {
      const store = storage || window.localStorage;
      return ThemeManager.normalize(store.getItem(ThemeManager.KEY));
    } catch (e) {
      return ThemeManager.DEFAULT;
    }
  },

  // Choice yaad rakho. true = save hua
  save(theme, storage) {
    try {
      const store = storage || window.localStorage;
      store.setItem(ThemeManager.KEY, ThemeManager.normalize(theme));
      return true;
    } catch (e) {
      return false;
    }
  },

  current() {
    try {
      return ThemeManager.normalize(document.documentElement.getAttribute('data-theme'));
    } catch (e) {
      return ThemeManager.DEFAULT;
    }
  },

  // Theme lagao. persist=false se sirf dikhao, save mat karo.
  apply(theme, persist) {
    const next = ThemeManager.normalize(theme);
    const root = document.documentElement;
    const changed = root.getAttribute('data-theme') !== next;
    if (changed) {
      // rang halke se badlein (reduced motion mein CSS ye transition hata deti hai)
      root.classList.add('theme-fade');
      window.clearTimeout(ThemeManager._fadeTimer);
      ThemeManager._fadeTimer = window.setTimeout(() => root.classList.remove('theme-fade'), 500);
      root.setAttribute('data-theme', next);
    }
    if (typeof Utils !== 'undefined' && Utils.clearThemeCache) Utils.clearThemeCache();
    ThemeManager.syncButtons(next);
    if (persist !== false) ThemeManager.save(next);
    if (changed) {
      let ev;
      try { ev = new CustomEvent('themechange', { detail: { theme: next } }); }
      catch (e) { ev = document.createEvent('CustomEvent'); ev.initCustomEvent('themechange', false, false, { theme: next }); }
      document.dispatchEvent(ev);
    }
    return next;
  },

  // Swatch buttons: sirf chuna hua aria-pressed="true"
  syncButtons(theme) {
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-theme-choice') === theme ? 'true' : 'false');
    });
  },

  init() {
    ThemeManager.apply(ThemeManager.load(), false);
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.addEventListener('click', () => ThemeManager.apply(btn.getAttribute('data-theme-choice'), true));
    });
    // Doosri tab mein theme badle to yahan bhi badal do
    window.addEventListener('storage', (e) => {
      if (e.key === ThemeManager.KEY) ThemeManager.apply(ThemeManager.normalize(e.newValue), false);
    });
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = ThemeManager;


/* ===== js/sampleData.js ===== */
// sampleData.js
// Pehli baar app khulne par ye sample data localStorage mein save hota hai,
// taaki Results screen kabhi khali na dikhe.
//
// Data shape (README mein bhi likha hai):
//   Result  = { resultId, experimentType, name, inputs, outputs, theoreticalValue,
//               measuredValue, valueLabel, unit, status, createdAt }
//   Circuit = { circuitId, name, components, connections, updatedAt }

const SampleData = {
  circuits() {
    return [
      {
        circuitId: 'circ_sample_1',
        name: 'Two resistors in series',
        components: {
          topology: 'series', voltage: 12, switchPresent: true, switchClosed: true,
          resistors: [
            { id: 'r1', ohms: 4, connected: true },
            { id: 'r2', ohms: 6, connected: true },
          ],
          wireCount: 0,
        },
        connections: 'series: battery -> switch -> R1 -> R2 -> back to battery',
        updatedAt: '2026-11-02T10:15:00.000Z',
      },
      {
        circuitId: 'circ_sample_2',
        name: 'Two resistors in parallel',
        components: {
          topology: 'parallel', voltage: 12, switchPresent: true, switchClosed: true,
          resistors: [
            { id: 'r1', ohms: 6, connected: true },
            { id: 'r2', ohms: 3, connected: true },
          ],
          wireCount: 0,
        },
        connections: 'parallel: battery -> switch -> (R1 and R2 side by side) -> back to battery',
        updatedAt: '2026-11-03T09:40:00.000Z',
      },
      {
        circuitId: 'circ_sample_3',
        name: 'Three branch parallel (9 V)',
        components: {
          topology: 'parallel', voltage: 9, switchPresent: true, switchClosed: true,
          resistors: [
            { id: 'r1', ohms: 10, connected: true },
            { id: 'r2', ohms: 20, connected: true },
            { id: 'r3', ohms: 30, connected: true },
          ],
          wireCount: 0,
        },
        connections: 'parallel: three branches',
        updatedAt: '2026-11-04T14:05:00.000Z',
      },
    ];
  },

  results() {
    return [
      {
        resultId: 'res_sample_1', experimentType: 'circuit', name: 'Series 4 + 6 ohm at 12 V',
        inputs: { topology: 'series', voltage: 12, resistors: [4, 6] },
        outputs: { totalResistance: 10, current: 1.2, power: 14.4 },
        theoreticalValue: 1.2, measuredValue: 1.2, valueLabel: 'Current', unit: 'A',
        status: 'Matched', createdAt: '2026-11-02T10:20:00.000Z',
      },
      {
        resultId: 'res_sample_2', experimentType: 'circuit', name: 'Parallel 6 || 3 ohm at 12 V',
        inputs: { topology: 'parallel', voltage: 12, resistors: [6, 3] },
        outputs: { totalResistance: 2, current: 6, power: 72 },
        theoreticalValue: 6, measuredValue: 6, valueLabel: 'Current', unit: 'A',
        status: 'Matched', createdAt: '2026-11-03T09:45:00.000Z',
      },
      {
        resultId: 'res_sample_3', experimentType: 'circuit', name: 'Parallel with one loose wire',
        inputs: { topology: 'parallel', voltage: 9, resistors: [10, 20, 30], note: 'R3 was not connected' },
        outputs: { totalResistance: 6.667, current: 1.35, power: 12.15 },
        theoreticalValue: 1.65, measuredValue: 1.35, valueLabel: 'Current', unit: 'A',
        status: 'Needs repeat', createdAt: '2026-11-04T14:10:00.000Z',
      },
      {
        resultId: 'res_sample_4', experimentType: 'projectile', name: 'Cricket ball 45 degrees',
        inputs: { speed: 20, angle: 45, gravity: 9.81 },
        outputs: { range: 40.775, timeOfFlight: 2.883, maxHeight: 10.194 },
        theoreticalValue: 40.775, measuredValue: 40.775, valueLabel: 'Range', unit: 'm',
        status: 'Matched', createdAt: '2026-11-05T11:00:00.000Z',
      },
      {
        resultId: 'res_sample_5', experimentType: 'projectile', name: 'Steep launch 70 degrees',
        inputs: { speed: 25, angle: 70, gravity: 9.81 },
        outputs: { range: 40.952, timeOfFlight: 4.789, maxHeight: 28.129 },
        theoreticalValue: 40.952, measuredValue: 40.952, valueLabel: 'Range', unit: 'm',
        status: 'Matched', createdAt: '2026-11-05T11:20:00.000Z',
      },
      {
        resultId: 'res_sample_6', experimentType: 'pendulum', name: 'Pendulum 1 m, 10 degrees',
        inputs: { length: 1, angle: 10, gravity: 9.81 },
        outputs: { periodSimulated: 2.01, periodTheory: 2.006 },
        theoreticalValue: 2.006, measuredValue: 2.01, valueLabel: 'Period', unit: 's',
        status: 'Matched', createdAt: '2026-11-06T08:30:00.000Z',
      },
      {
        resultId: 'res_sample_7', experimentType: 'pendulum', name: 'Pendulum 1 m, 60 degrees (big swing)',
        inputs: { length: 1, angle: 60, gravity: 9.81 },
        outputs: { periodSimulated: 2.153, periodTheory: 2.006 },
        theoreticalValue: 2.006, measuredValue: 2.153, valueLabel: 'Period', unit: 's',
        status: 'Needs repeat', createdAt: '2026-11-06T08:45:00.000Z',
      },
    ];
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = SampleData;


/* ===== js/storage.js ===== */
// storage.js  (LocalDataStore)
// localStorage ke saath read / write / delete. Teen documented keys:
//   virtuallab_circuits, virtuallab_results, virtuallab_prefs
// Agar storage fail ho (full, blocked, private mode) to app crash nahi hota:
// current kaam screen par rehta hai aur memory mein kaam chalta hai.

const Store = {
  KEYS: {
    circuits: 'virtuallab_circuits',
    results: 'virtuallab_results',
    prefs: 'virtuallab_prefs',
  },

  // Backup copy memory mein (agar localStorage kaam na kare)
  memory: {},
  // Aakhri problem ka message (UI isko dikhata hai)
  lastProblem: '',

  // Raw JSON read. Missing => undefined, corrupt => null
  readRaw(key) {
    try {
      const text = window.localStorage.getItem(key);
      if (text === null) return undefined;
      return JSON.parse(text);
    } catch (error) {
      // Ya to storage blocked hai, ya JSON kharab hai
      if (key in Store.memory) return Store.memory[key];
      return null;
    }
  },

  // Write. Returns { ok: true } ya { ok: false, message }
  write(key, value) {
    Store.memory[key] = value;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      Store.lastProblem = '';
      return { ok: true };
    } catch (error) {
      Store.lastProblem =
        'Your data could not be saved in this browser (storage may be full or blocked). Your current work is still on screen. Try exporting your results or freeing browser storage.';
      return { ok: false, message: Store.lastProblem };
    }
  },

  // App start par: agar key nahi hai ya kharab hai to sample data daalo
  ensureSampleData() {
    let reloaded = false;
    const circuits = Store.readRaw(Store.KEYS.circuits);
    if (!Array.isArray(circuits)) {
      Store.write(Store.KEYS.circuits, SampleData.circuits());
      reloaded = true;
    }
    const results = Store.readRaw(Store.KEYS.results);
    if (!Array.isArray(results)) {
      Store.write(Store.KEYS.results, SampleData.results());
      reloaded = true;
    }
    return reloaded;
  },

  // Sample data wapas laao (purana data replace hota hai)
  resetSampleData() {
    const a = Store.write(Store.KEYS.circuits, SampleData.circuits());
    const b = Store.write(Store.KEYS.results, SampleData.results());
    return a.ok && b.ok ? { ok: true } : { ok: false, message: Store.lastProblem };
  },

  // ----- Results -----
  getResults() {
    const list = Store.readRaw(Store.KEYS.results);
    return Array.isArray(list) ? list : [];
  },

  getResult(resultId) {
    return Store.getResults().find((r) => r.resultId === resultId) || null;
  },

  // Naya result add (sabse upar)
  addResult(result) {
    const list = Store.getResults();
    list.unshift(result);
    return Store.write(Store.KEYS.results, list);
  },

  deleteResult(resultId) {
    const list = Store.getResults().filter((r) => r.resultId !== resultId);
    return Store.write(Store.KEYS.results, list);
  },

  // ----- Circuits -----
  getCircuits() {
    const list = Store.readRaw(Store.KEYS.circuits);
    return Array.isArray(list) ? list : [];
  },

  // Same circuitId ho to update, warna add
  saveCircuit(design) {
    const list = Store.getCircuits();
    const index = list.findIndex((c) => c.circuitId === design.circuitId);
    if (index >= 0) list[index] = design;
    else list.unshift(design);
    return Store.write(Store.KEYS.circuits, list);
  },

  // ----- Preferences -----
  getPrefs() {
    const defaults = { role: 'student', units: 'SI', lastExperiment: '' };
    const saved = Store.readRaw(Store.KEYS.prefs);
    if (!saved || typeof saved !== 'object') return defaults;
    return Object.assign(defaults, saved);
  },

  savePrefs(prefs) {
    return Store.write(Store.KEYS.prefs, prefs);
  },
};


/* ===== js/ui.js ===== */
// ui.js
// Chhote UI helpers jo sab screens use karti hain:
// messages (FeedbackMessage), field errors, slider + number link, status badge, dates.

const UI = {
  // Short shortcut: id se element
  byId(id) {
    return document.getElementById(id);
  },

  // Message dikhao (FeedbackMessage). type: 'success' | 'warning' | 'danger' | 'info'
  // Color ke saath word bhi hota hai (Success / Warning / Error), taaki sirf color par depend na ho.
  showMessage(containerId, type, text) {
    const box = UI.byId(containerId);
    if (!box) return;
    const labels = { success: 'Success', warning: 'Warning', danger: 'Error', info: 'Note' };
    const role = type === 'danger' ? 'alert' : 'status';
    box.innerHTML =
      '<div class="alert alert-' + type + ' alert-dismissible fade show mb-0" role="' + role + '">' +
      '<strong>' + labels[type] + ':</strong> ' + Utils.escapeHtml(text) +
      '<button type="button" class="btn-close" aria-label="Dismiss message"></button></div>';
    box.querySelector('.btn-close').addEventListener('click', () => { box.innerHTML = ''; });
  },

  clearMessage(containerId) {
    const box = UI.byId(containerId);
    if (box) box.innerHTML = '';
  },

  // Input ke neeche error dikhao (ya hatao agar message khali ho)
  setFieldError(inputEl, errorId, message) {
    const errorEl = UI.byId(errorId);
    if (message) {
      inputEl.classList.add('is-invalid');
      inputEl.setAttribute('aria-invalid', 'true');
      if (errorEl) errorEl.textContent = message;
    } else {
      inputEl.classList.remove('is-invalid');
      inputEl.removeAttribute('aria-invalid');
      if (errorEl) errorEl.textContent = '';
    }
  },

  // Slider aur number box ko sync rakho. onChange har change par chalega.
  linkRangeAndNumber(rangeEl, numberEl, onChange) {
    rangeEl.addEventListener('input', () => {
      numberEl.value = rangeEl.value;
      onChange();
    });
    numberEl.addEventListener('input', () => {
      // Sirf valid number ho to slider hilao
      if (numberEl.value !== '' && !Number.isNaN(Number(numberEl.value))) {
        rangeEl.value = numberEl.value;
      }
      onChange();
    });
  },

  // Status badge: icon + text (color akela nahi)
  statusBadge(status) {
    if (status === 'Matched') return '<span class="badge badge-ok">Matched</span>';
    return '<span class="badge badge-warn">Needs repeat</span>';
  },

  typeLabel(type) {
    const names = { circuit: 'Circuit', projectile: 'Projectile', pendulum: 'Pendulum' };
    return names[type] || type;
  },

  formatDate(isoText) {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  },

  // Ek readout tile: label + value
  readoutTile(label, valueText) {
    return '<div class="readout-tile"><div class="readout-label">' + Utils.escapeHtml(label) +
      '</div><div class="readout-value">' + valueText + '</div></div>';
  },

  // Save ke baad: result ko Store mein daalo aur message dikhao.
  // Storage fail ho to error dikhta hai, current kaam screen par rehta hai.
  saveResultWithMessage(result, feedbackId) {
    const outcome = Store.addResult(result);
    if (outcome.ok) {
      UI.showMessage(feedbackId, 'success', 'Saved. You will find it under Results.');
    } else {
      UI.showMessage(feedbackId, 'danger', outcome.message);
    }
    return outcome.ok;
  },
};


/* ===== js/roles.js ===== */
// roles.js
// Student / Teacher view switch. Role prefs mein save hota hai (virtuallab_prefs).
// Teacher-only cheezein HTML mein data-role="teacher" se mark hoti hain.
// NOTE: login nahi hai, isliye ye security nahi hai - sirf view switch hai.

const Roles = {
  current() {
    return Store.getPrefs().role === 'teacher' ? 'teacher' : 'student';
  },

  isTeacher() {
    return Roles.current() === 'teacher';
  },

  set(role) {
    const prefs = Store.getPrefs();
    prefs.role = role === 'teacher' ? 'teacher' : 'student';
    Store.savePrefs(prefs);
    Roles.apply();
  },

  // Student view mein teacher-only elements hide (hidden attribute) ho jate hain
  apply() {
    const teacher = Roles.isTeacher();
    document.querySelectorAll('[data-role="teacher"]').forEach((el) => {
      el.hidden = !teacher;
    });
    const select = document.getElementById('role-select');
    if (select) select.value = Roles.current();
  },

  // Teacher-only kaam karne se pehle check (export, teacher screen, reset)
  require(actionName) {
    if (Roles.isTeacher()) return true;
    UI.showMessage('global-feedback', 'warning',
      actionName + ' is only available in Teacher view. Switch "View as" to Teacher to use it.');
    return false;
  },
};


/* ===== js/dashboard.js ===== */
// dashboard.js
// Lab Dashboard screen: experiment cards, "continue" link, recent results.

const Dashboard = {
  // Labs ki list (dashboard par rows ban kar dikhti hain)
  experiments: [
    { screen: 'circuit', title: 'Circuit Lab',
      text: 'Put a battery, resistors and a switch in series or parallel and read the current and voltage.' },
    { screen: 'projectile', title: 'Projectile Motion',
      text: 'Throw a ball and compare range, time in the air and maximum height with the formulas.' },
    { screen: 'pendulum', title: 'Simple Pendulum',
      text: 'Swing a pendulum and compare the time of one swing with T = 2π√(L/g).' },
    { screen: 'results', title: 'Saved results',
      text: 'Search and open the things you saved earlier.' },
  ],

  render() {
    Dashboard.renderCards();
    Dashboard.renderContinue();
    Dashboard.renderTeacherSummary();
    Dashboard.renderRecent();
  },

  renderCards() {
    const html = Dashboard.experiments.map((exp) =>
      '<a class="lab-row" href="#' + exp.screen + '" aria-label="Open ' + exp.title + '">' +
      '<span class="lab-row-text"><span class="lab-row-title">' + exp.title + '</span>' +
      '<span class="lab-row-desc">' + exp.text + '</span></span>' +
      '<span class="lab-row-go" aria-hidden="true">Open &rarr;</span></a>').join('');
    UI.byId('experiment-cards').innerHTML = html;
  },

  // "Jahan chhoda tha wahan se" (prefs.lastExperiment)
  renderContinue() {
    const last = Store.getPrefs().lastExperiment;
    const exp = Dashboard.experiments.find((e) => e.screen === last);
    UI.byId('dashboard-continue').innerHTML = exp
      ? '<p class="continue-line">Last time you were in <strong>' + exp.title + '</strong>. <a href="#' + exp.screen + '">Go back to it</a></p>'
      : '';
  },

  renderTeacherSummary() {
    const results = Store.getResults();
    const repeat = results.filter((r) => r.status !== 'Matched').length;
    UI.byId('dashboard-teacher-summary').textContent =
      results.length + ' saved results, ' + repeat + ' marked "Needs repeat".';
  },

  renderRecent() {
    const results = Store.getResults()
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 5);
    const box = UI.byId('dashboard-recent');
    if (results.length === 0) {
      box.innerHTML = Results.emptyStateHtml();
      Results.bindEmptyState(box);
      return;
    }
    box.innerHTML = '<ul class="list-group">' + results.map((r) =>
      '<li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">' +
      '<span><a href="#result/' + encodeURIComponent(r.resultId) + '">' + Utils.escapeHtml(r.name) + '</a> ' +
      '<span class="text-muted-vl small">(' + UI.typeLabel(r.experimentType) + ')</span></span>' +
      UI.statusBadge(r.status) + '</li>').join('') + '</ul>';
  },
};


/* ===== js/circuitSolver.js ===== */
// circuitSolver.js
// Pure logic for the Circuit Lab table: parts + wires -> net list -> DC solve.
// No DOM here, so it can be tested in Node (tests/tests.js).
//
// A design looks like:
//   { parts: [{ id, type, gx, gy, rot, value, closed }], wires: [{ id, a:{p,t}, b:{p,t}, route }] }
//   type: 'battery' | 'resistor' | 'bulb' | 'switch' | 'ammeter' | 'voltmeter'
//   Every part has 2 terminals: t = 0 and t = 1. Battery: t0 is minus, t1 is plus.
//   gx, gy are grid cells of the part centre. Terminals sit 2 cells left/right of the centre,
//   then rotate by rot * 90 degrees (clockwise on screen).

const CircuitSolver = {
  GRID: 20,
  HALF: 2,                 // terminal distance from centre, in grid cells
  AMMETER_OHMS: 1e-6,
  SWITCH_ON_OHMS: 1e-6,
  VOLTMETER_OHMS: 1e7,
  BULB_RATED_WATTS: 0.5,   // glow = power / rated (max 1)
  TYPES: ['battery', 'resistor', 'bulb', 'switch', 'ammeter', 'voltmeter'],

  // Default value of a new part (volts for battery, ohms for resistor/bulb)
  defaultValue(type) {
    if (type === 'battery') return 9;
    if (type === 'resistor') return 100;
    if (type === 'bulb') return 30;
    return 0;
  },

  // Terminal position in grid cells (offset from the part centre, rotated)
  terminalOffset(rot, t) {
    let x = t === 0 ? -CircuitSolver.HALF : CircuitSolver.HALF;
    let y = 0;
    const turns = ((rot || 0) % 4 + 4) % 4;
    for (let i = 0; i < turns; i++) { const nx = -y; y = x; x = nx; }
    return { x, y };
  },
  terminalCell(part, t) {
    const o = CircuitSolver.terminalOffset(part.rot, t);
    return { x: part.gx + o.x, y: part.gy + o.y };
  },

  // Resistance of a part for the solver. null = open (no connection through the part).
  // Voltage sources are handled separately.
  partOhms(part) {
    const S = CircuitSolver;
    if (part.type === 'resistor' || part.type === 'bulb') return Number(part.value);
    if (part.type === 'ammeter') return S.AMMETER_OHMS;
    if (part.type === 'voltmeter') return S.VOLTMETER_OHMS;
    if (part.type === 'switch') return part.closed ? S.SWITCH_ON_OHMS : null;
    return null;
  },

  // Net list: union-find over terminals joined by wires.
  // Returns { netOf(partId, t) -> net index, nets: count, key(...) }
  buildNetlist(design) {
    const parent = {};
    const key = (p, t) => p + ':' + t;
    const find = (k) => {
      if (parent[k] === undefined) parent[k] = k;
      while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
      return k;
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const parts = design.parts || [];
    parts.forEach((p) => { find(key(p.id, 0)); find(key(p.id, 1)); });
    (design.wires || []).forEach((w) => {
      if (!w.a || !w.b) return;
      const ka = key(w.a.p, w.a.t), kb = key(w.b.p, w.b.t);
      if (parent[ka] === undefined || parent[kb] === undefined) return; // wire to a missing part
      union(ka, kb);
    });
    const index = {};
    let count = 0;
    const netOf = (p, t) => {
      const root = find(key(p, t));
      if (index[root] === undefined) index[root] = count++;
      return index[root];
    };
    parts.forEach((p) => { netOf(p.id, 0); netOf(p.id, 1); });
    return { netOf, nets: count };
  },

  // Gaussian elimination with partial pivoting. Returns solution or null if singular.
  _gauss(A, b) {
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-18) return null;
      if (piv !== c) { const t = A[c]; A[c] = A[piv]; A[piv] = t; const tb = b[c]; b[c] = b[piv]; b[piv] = tb; }
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        if (f === 0) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  },

  // Solve the DC circuit (nodal analysis).
  // Result: { status, message, warnings[], running, parts: { [id]: {v, i, p, glow} },
  //           current, voltage, power, totalResistance }
  //   status: 'empty' | 'nobattery' | 'open' | 'short' | 'error' | 'ok'
  //   For each part: v = voltage across (t1 minus t0), i = current t0 -> t1 inside the part,
  //   p = power (always >= 0), glow = 0..1 for bulbs.
  solve(design) {
    const S = CircuitSolver;
    const parts = design.parts || [];
    const out = {
      status: 'ok', message: '', warnings: [], parts: {},
      current: 0, voltage: 0, power: 0, totalResistance: null,
    };
    parts.forEach((p) => { out.parts[p.id] = { v: 0, i: 0, p: 0, glow: 0 }; });

    if (parts.length === 0) {
      out.status = 'empty';
      out.message = 'The table is empty. Drag parts from the tray, or try a preset circuit.';
      return out;
    }
    const batteries = parts.filter((p) => p.type === 'battery');
    if (batteries.length === 0) {
      out.status = 'nobattery';
      out.message = 'No battery on the table yet. Drag a battery in to power the circuit.';
      return out;
    }

    const bad = parts.find((p) => (p.type === 'resistor' || p.type === 'bulb') && !(Number(p.value) > 0));
    if (bad) {
      out.status = 'error';
      out.message = 'A resistance must be greater than 0 ohms. Check the value you typed.';
      return out;
    }

    const net = S.buildNetlist(design);

    // Short circuit: a battery whose two ends are joined only by wires / closed switches / ammeters.
    // Union-find over "zero resistance" parts, without crossing any battery.
    const zp = {};
    const zf = (k) => { if (zp[k] === undefined) zp[k] = k; while (zp[k] !== k) { zp[k] = zp[zp[k]]; k = zp[k]; } return k; };
    parts.forEach((p) => {
      if (p.type === 'switch' && p.closed || p.type === 'ammeter') {
        const a = zf(net.netOf(p.id, 0)), b = zf(net.netOf(p.id, 1));
        if (a !== b) zp[a] = b;
      }
    });
    const shorted = batteries.filter((b) => zf(net.netOf(b.id, 0)) === zf(net.netOf(b.id, 1)));
    if (shorted.length) {
      out.status = 'short';
      out.message = 'Short circuit. The battery ends are joined with no resistance in between, so the circuit is stopped. Add a resistor or bulb in the path.';
      return out;
    }

    // Nodal analysis: unknowns = node voltages (net 0 is ground) + one current per battery.
    const n = net.nets;
    const m = batteries.length;
    const size = (n - 1) + m;
    const A = []; const rhs = new Array(size).fill(0);
    for (let i = 0; i < size; i++) A.push(new Array(size).fill(0));
    const idx = (netNo) => netNo - 1; // ground (0) has no row
    const GMIN = 1e-12;
    for (let k = 1; k < n; k++) A[idx(k)][idx(k)] += GMIN;

    parts.forEach((p) => {
      const ohms = S.partOhms(p);
      if (p.type === 'battery' || ohms === null) return;
      const g = 1 / ohms;
      const a = net.netOf(p.id, 0), b = net.netOf(p.id, 1);
      if (a > 0) A[idx(a)][idx(a)] += g;
      if (b > 0) A[idx(b)][idx(b)] += g;
      if (a > 0 && b > 0) { A[idx(a)][idx(b)] -= g; A[idx(b)][idx(a)] -= g; }
    });
    batteries.forEach((bat, j) => {
      const row = (n - 1) + j;
      const minus = net.netOf(bat.id, 0), plus = net.netOf(bat.id, 1);
      // current variable = current flowing out of the plus terminal into the circuit
      if (plus > 0) { A[idx(plus)][row] += 1; A[row][idx(plus)] += 1; }
      if (minus > 0) { A[idx(minus)][row] -= 1; A[row][idx(minus)] -= 1; }
      rhs[row] = Number(bat.value);
    });

    const x = S._gauss(A, rhs);
    if (!x) {
      out.status = 'error';
      out.message = 'This circuit cannot be solved (for example two batteries pushing against each other). Check the wiring.';
      return out;
    }
    const volt = (netNo) => (netNo === 0 ? 0 : x[idx(netNo)]);

    let loadCurrent = 0;
    parts.forEach((p) => {
      const r = out.parts[p.id];
      const a = volt(net.netOf(p.id, 0)), b = volt(net.netOf(p.id, 1));
      r.v = b - a;
      if (p.type === 'battery') {
        const j = batteries.indexOf(p);
        r.i = -x[(n - 1) + j];   // current delivered out of the plus terminal
        r.p = r.v * r.i;
        r.v = Number(p.value);
      } else {
        const ohms = S.partOhms(p);
        r.i = ohms === null ? 0 : (a - b) / ohms;   // current from t0 to t1
        r.p = Math.abs(r.v * r.i);
        if (p.type === 'bulb') r.glow = Math.max(0, Math.min(1, r.p / S.BULB_RATED_WATTS));
        if ((p.type === 'resistor' || p.type === 'bulb') && Math.abs(r.i) > loadCurrent) loadCurrent = Math.abs(r.i);
      }
      // clean tiny numerical noise
      if (Math.abs(r.i) < 1e-9) r.i = 0;
      if (Math.abs(r.v) < 1e-5) r.v = 0;
      if (r.p < 1e-12) r.p = 0;
    });

    if (loadCurrent < 1e-9) {
      out.status = 'open';
      out.message = 'The circuit is not closed, so no current flows. Close the switch or finish the wiring.';
      return out;
    }

    // Totals from the first battery
    const b0 = batteries[0];
    out.voltage = Number(b0.value);
    out.current = Math.abs(out.parts[b0.id].i);
    out.power = batteries.reduce((s, b) => s + Math.max(0, out.parts[b.id].p), 0);
    out.totalResistance = out.current > 0 ? out.voltage / out.current : null;
    out.status = 'ok';
    out.message = 'Circuit closed. Current is flowing: ' + S.fmt(out.current, 'A') + ' from the battery.';

    parts.forEach((p) => {
      const r = out.parts[p.id];
      if (p.type === 'bulb' && r.p > 5 * S.BULB_RATED_WATTS) {
        out.warnings.push('A bulb is getting far more power than it is made for. In real life it would burn out.');
      }
      if (p.type === 'ammeter' && Math.abs(r.i) > 5) {
        out.warnings.push('The ammeter is carrying a very large current. An ammeter should sit in series with a load.');
      }
    });
    const floating = parts.filter((p) => {
      const a = net.netOf(p.id, 0), b = net.netOf(p.id, 1);
      return p.type !== 'battery' && a === b && p.type !== 'voltmeter';
    });
    if (floating.length) out.warnings.push('A part has both ends on the same wire, so it does nothing.');
    return out;
  },

  // How the loads are connected: 'series', 'parallel' or 'mixed'
  topology(design) {
    const S = CircuitSolver;
    const net = S.buildNetlist(design);
    const loads = (design.parts || []).filter((p) => p.type === 'resistor' || p.type === 'bulb');
    if (loads.length < 2) return 'series';
    const pairs = {};
    loads.forEach((p) => {
      const a = net.netOf(p.id, 0), b = net.netOf(p.id, 1);
      const k = Math.min(a, b) + '-' + Math.max(a, b);
      pairs[k] = (pairs[k] || 0) + 1;
    });
    const groups = Object.keys(pairs).length;
    if (groups === 1) return 'parallel';
    if (groups === loads.length) return 'series';
    return 'mixed';
  },

  // Plain number formatting (Utils is not loaded in Node tests)
  fmt(value, unit) {
    const v = Math.abs(value);
    let n;
    if (v === 0) n = '0';
    else if (v >= 100) n = value.toFixed(1);
    else if (v >= 1) n = value.toFixed(2);
    else if (v >= 0.001) n = value.toFixed(3);
    else n = value.toExponential(2);
    return n + ' ' + unit;
  },

  // ----- Preset circuits (grid cells, all wires straight) -----
  preset(name) {
    const mk = (id, type, gx, gy, rot, value, closed) => ({ id, type, gx, gy, rot, value: value === undefined ? CircuitSolver.defaultValue(type) : value, closed: closed !== false });
    const w = (id, ap, at, bp, bt) => ({ id, a: { p: ap, t: at }, b: { p: bp, t: bt }, route: 'auto' });
    if (name === 'parallel') {
      return {
        parts: [
          mk('p1', 'battery', 6, 10, 3, 9), mk('p2', 'switch', 11, 8, 0, 0, true),
          mk('p3', 'resistor', 18, 10, 1, 60), mk('p4', 'bulb', 27, 10, 1, 30),
          mk('p5', 'voltmeter', 35, 10, 1, 0), mk('p6', 'ammeter', 12, 12, 0, 0),
        ],
        wires: [
          w('w1', 'p1', 1, 'p2', 0), w('w2', 'p2', 1, 'p3', 0), w('w3', 'p3', 0, 'p4', 0), w('w4', 'p4', 0, 'p5', 0),
          w('w5', 'p1', 0, 'p6', 0), w('w6', 'p6', 1, 'p3', 1), w('w7', 'p3', 1, 'p4', 1), w('w8', 'p4', 1, 'p5', 1),
        ],
      };
    }
    // series
    return {
      parts: [
        mk('p1', 'battery', 6, 10, 3, 9), mk('p2', 'switch', 12, 8, 0, 0, true),
        mk('p3', 'resistor', 20, 8, 0, 60), mk('p4', 'bulb', 30, 10, 1, 30),
        mk('p5', 'ammeter', 18, 12, 0, 0),
      ],
      wires: [
        w('w1', 'p1', 1, 'p2', 0), w('w2', 'p2', 1, 'p3', 0), w('w3', 'p3', 1, 'p4', 0),
        w('w4', 'p4', 1, 'p5', 1), w('w5', 'p5', 0, 'p1', 0),
      ],
    };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = CircuitSolver;


/* ===== js/circuitDraw.js ===== */
// circuitDraw.js
// Draws the lab table (grid, parts, wires, terminals) as one SVG string.
// Colours come from CSS classes (css/style.css), so every theme works without code changes.
// Geometry (terminal positions, wire routes) comes from CircuitSolver.

const CircuitDraw = {
  CELL: 20,
  COLS: 40,
  ROWS: 24,
  NAMES: { battery: 'Battery', resistor: 'Resistor', bulb: 'Bulb', switch: 'Switch', ammeter: 'Ammeter', voltmeter: 'Voltmeter' },
  PREFIX: { battery: 'B', resistor: 'R', bulb: 'L', switch: 'S', ammeter: 'A', voltmeter: 'V' },

  // Short names by position: B1, R1, R2, L1 ...
  names(design) {
    const count = {};
    const out = {};
    (design.parts || []).forEach((p) => {
      count[p.type] = (count[p.type] || 0) + 1;
      out[p.id] = CircuitDraw.PREFIX[p.type] + count[p.type];
    });
    return out;
  },

  px(cell) { return cell * CircuitDraw.CELL; },

  // Wire polyline in grid cells, or null if a part is missing
  wirePoints(design, wire) {
    const S = CircuitSolver;
    const pa = (design.parts || []).find((p) => p.id === wire.a.p);
    const pb = (design.parts || []).find((p) => p.id === wire.b.p);
    if (!pa || !pb) return null;
    const a = S.terminalCell(pa, wire.a.t), b = S.terminalCell(pb, wire.b.t);
    if (a.x === b.x || a.y === b.y) return [a, b];
    const o = S.terminalOffset(pa.rot, wire.a.t);
    let horizontalFirst = o.x !== 0;
    if (wire.route === 'flip') horizontalFirst = !horizontalFirst;
    const bend = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return [a, bend, b];
  },

  fmt(value, unit) {
    return typeof Utils !== 'undefined' ? Utils.formatWithUnit(value, unit) : CircuitSolver.fmt(value, unit);
  },

  // Symbol of one part, drawn around (0,0) with terminals at x = -40 and +40
  symbol(p, res, isOn) {
    const lead = (x1, x2) => '<line class="lead" x1="' + x1 + '" y1="0" x2="' + x2 + '" y2="0"/>';
    if (p.type === 'battery') {
      return lead(-40, -5) + lead(5, 40) +
        '<line class="body" x1="-5" y1="-9" x2="-5" y2="9" stroke-width="4"/>' +
        '<line class="body" x1="5" y1="-17" x2="5" y2="17"/>';
    }
    if (p.type === 'resistor') {
      return lead(-40, -22) + lead(22, 40) +
        '<polyline class="body" fill="none" points="-22,0 -17,-9 -9,9 -1,-9 7,9 15,-9 22,0"/>';
    }
    if (p.type === 'bulb') {
      const g = res ? res.glow : 0;
      return lead(-40, -15) + lead(15, 40) +
        '<circle class="glow-halo" r="30" style="opacity:' + (g * 0.95).toFixed(3) + '" filter="url(#lab-blur)"/>' +
        '<circle class="bulb-glass" r="15" style="fill-opacity:' + (0.12 + g * 0.85).toFixed(3) + '"/>' +
        '<polyline class="body" fill="none" points="-9,9 -5,-4 0,6 5,-4 9,9"/>';
    }
    if (p.type === 'switch') {
      const lever = p.closed ? '34,0' : '30,-18';
      return lead(-40, -22) + lead(26, 40) +
        '<line class="body" x1="-22" y1="0" x2="' + (p.closed ? 26 : 22) + '" y2="' + (p.closed ? 0 : -18) + '"/>' +
        '<circle class="body-dot" cx="-22" cy="0" r="3.5"/><circle class="body-dot" cx="26" cy="0" r="3.5"/>';
    }
    // meters: counter-rotate the letter so it stays upright
    const letter = p.type === 'ammeter' ? 'A' : 'V';
    return lead(-40, -16) + lead(16, 40) +
      '<circle class="body meter-ring" r="16"/>' +
      '<text class="meter-letter" text-anchor="middle" dominant-baseline="central" transform="rotate(' + (-(p.rot || 0) * 90) + ')">' + letter + '</text>';
  },

  // Whole table. view = { selPart, selWire, running, result, temp, hover, wireMode }
  render(design, view) {
    const C = CircuitDraw, S = CircuitSolver;
    const W = C.COLS * C.CELL, H = C.ROWS * C.CELL;
    const names = C.names(design);
    const result = view.running ? view.result : null;
    const live = !!(result && result.status === 'ok');
    const used = {};
    let svg = '<svg class="lab-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" ' +
      'aria-label="Circuit lab table with a grid. Use the tray and the buttons beside it to build a circuit.">' +
      '<defs><pattern id="lab-grid" width="' + C.CELL + '" height="' + C.CELL + '" patternUnits="userSpaceOnUse">' +
      '<circle cx="0" cy="0" r="1.1" class="grid-dot"/><circle cx="' + C.CELL + '" cy="0" r="1.1" class="grid-dot"/>' +
      '<circle cx="0" cy="' + C.CELL + '" r="1.1" class="grid-dot"/><circle cx="' + C.CELL + '" cy="' + C.CELL + '" r="1.1" class="grid-dot"/></pattern>' +
      '<filter id="lab-blur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7"/></filter></defs>' +
      '<rect class="table-bg" x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#lab-grid)" data-table="1"/>';

    // wires
    (design.wires || []).forEach((w) => {
      const pts = C.wirePoints(design, w);
      if (!pts) return;
      used[w.a.p + ':' + w.a.t] = (used[w.a.p + ':' + w.a.t] || 0) + 1;
      used[w.b.p + ':' + w.b.t] = (used[w.b.p + ':' + w.b.t] || 0) + 1;
      const d = 'M' + pts.map((q) => C.px(q.x) + ' ' + C.px(q.y)).join(' L');
      const sel = view.selWire === w.id;
      svg += '<g class="wire-g' + (sel ? ' selected' : '') + '" data-wire="' + w.id + '">' +
        '<path class="wire-hit" d="' + d + '"/>' +
        '<path class="wire' + (live ? ' live' : '') + '" d="' + d + '"/>' +
        (live ? '<path class="wire-flow" d="' + d + '"/>' : '') + '</g>';
    });

    // parts
    (design.parts || []).forEach((p) => {
      const r = result ? result.parts[p.id] : null;
      const sel = view.selPart === p.id;
      const cx = C.px(p.gx), cy = C.px(p.gy);
      svg += '<g class="part part-' + p.type + (sel ? ' selected' : '') + '" data-part="' + p.id + '" transform="translate(' + cx + ' ' + cy + ')">' +
        '<g transform="rotate(' + ((p.rot || 0) * 90) + ')">' +
        '<rect class="part-hit" x="-30" y="-22" width="60" height="44" rx="6"/>' +
        (sel ? '<rect class="part-sel" x="-44" y="-26" width="88" height="52" rx="8"/>' : '') +
        C.symbol(p, r, true) + '</g></g>';
    });

    // value labels (not rotated)
    (design.parts || []).forEach((p) => {
      const r = result ? result.parts[p.id] : null;
      const vertical = (p.rot || 0) % 2 === 1;
      const x = C.px(p.gx) + (vertical ? 24 : 0);
      const y = C.px(p.gy) + (vertical ? 4 : 34);
      const anchor = vertical ? 'start' : 'middle';
      let line1 = names[p.id];
      if (p.type === 'battery') line1 += ' ' + p.value + ' V';
      else if (p.type === 'resistor' || p.type === 'bulb') line1 += ' ' + p.value + ' Ω';
      else if (p.type === 'switch') line1 += p.closed ? ' closed' : ' open';
      let line2 = '';
      if (r) {
        if (p.type === 'ammeter') line2 = C.fmt(Math.abs(r.i), 'A');
        else if (p.type === 'voltmeter') line2 = C.fmt(Math.abs(r.v), 'V');
        else if (p.type === 'resistor' || p.type === 'bulb') line2 = C.fmt(Math.abs(r.i), 'A');
        else if (p.type === 'battery' && result.status === 'ok') line2 = C.fmt(Math.abs(r.i), 'A');
      }
      svg += '<text class="part-label" x="' + x + '" y="' + y + '" text-anchor="' + anchor + '">' + Utils.escapeHtml(line1) + '</text>';
      if (line2) svg += '<text class="part-reading" x="' + x + '" y="' + (y + 15) + '" text-anchor="' + anchor + '">' + Utils.escapeHtml(line2) + '</text>';
      if (p.type === 'battery') {
        const tp = S.terminalCell(p, 1), tm = S.terminalCell(p, 0);
        svg += '<text class="pol" x="' + (C.px(tp.x) + 9) + '" y="' + (C.px(tp.y) - 7) + '">+</text>' +
          '<text class="pol" x="' + (C.px(tm.x) + 9) + '" y="' + (C.px(tm.y) + 15) + '">−</text>';
      }
    });

    // terminals (dots) on top of everything
    (design.parts || []).forEach((p) => {
      [0, 1].forEach((t) => {
        const c = S.terminalCell(p, t);
        const k = p.id + ':' + t;
        const hot = view.hover && view.hover.p === p.id && view.hover.t === t;
        svg += '<g class="term' + (used[k] ? ' wired' : '') + (hot ? ' hot' : '') + (view.wireMode ? ' wiremode' : '') + '" data-term="' + k + '" transform="translate(' + C.px(c.x) + ' ' + C.px(c.y) + ')">' +
          '<circle class="term-hit" r="12"/><circle class="term-dot" r="' + (hot ? 7 : 5) + '"/></g>';
      });
    });

    // wire being drawn
    if (view.temp) {
      const pa = design.parts.find((p) => p.id === view.temp.from.p);
      if (pa) {
        const a = S.terminalCell(pa, view.temp.from.t);
        svg += '<line class="wire temp" x1="' + C.px(a.x) + '" y1="' + C.px(a.y) + '" x2="' + view.temp.x + '" y2="' + view.temp.y + '"/>';
      }
    }
    return svg + '</svg>';
  },

  // Tiny icon for the tray buttons
  trayIcon(type) {
    const body = CircuitDraw.symbol({ type, closed: true, rot: 0 }, null, false);
    return '<svg class="tray-icon" viewBox="-44 -26 88 52" width="52" height="30" aria-hidden="true" focusable="false">' + body + '</svg>';
  },
};


/* ===== js/circuitLab.js ===== */
// circuitLab.js
// Circuit Lab screen: a lab table where you drag parts, draw wires and run the simulation.
// Flow: user changes the table -> update() -> CircuitSolver.solve() -> CircuitDraw.render() + info panel.
// Needs: CircuitSolver, CircuitDraw, Physics, Validation, Utils, UI, Store.

const CircuitLab = {
  design: { parts: [], wires: [] },
  selPart: null,
  selWire: null,
  running: false,
  wireMode: false,
  result: null,
  designId: null,
  counter: 0,
  drag: null,        // part being moved or wire being drawn
  tray: null,        // tray item being dragged onto the table
  suppressClick: false,
  ready: false,

  // Tray items: what is shown, what gets added
  TRAY: [
    { type: 'battery', value: 9, label: 'Battery 9 V' },
    { type: 'battery', value: 1.5, label: 'Cell 1.5 V' },
    { type: 'resistor', value: 100, label: 'Resistor 100 Ω' },
    { type: 'resistor', value: 470, label: 'Resistor 470 Ω' },
    { type: 'bulb', value: 30, label: 'Bulb' },
    { type: 'switch', value: 0, label: 'Switch' },
    { type: 'ammeter', value: 0, label: 'Ammeter' },
    { type: 'voltmeter', value: 0, label: 'Voltmeter' },
  ],

  init() {
    const tray = UI.byId('palette-items');
    tray.innerHTML = CircuitLab.TRAY.map((t, i) =>
      '<button type="button" class="tray-item" data-tray="' + i + '" aria-label="Add ' + Utils.escapeHtml(t.label) + ' to the table (or drag it)">' +
      CircuitDraw.trayIcon(t.type) + '<span>' + Utils.escapeHtml(t.label) + '</span></button>').join('') +
      '<button type="button" class="tray-item tray-wire" id="btn-wire-mode" aria-pressed="false" aria-label="Wire tool: highlights the terminals. Drag from one terminal dot to another to draw a wire">' +
      '<svg class="tray-icon" viewBox="-44 -26 88 52" width="52" height="30" aria-hidden="true" focusable="false"><polyline class="body" fill="none" points="-36,12 -10,12 -10,-12 36,-12"/><circle class="term-dot" cx="-36" cy="12" r="5"/><circle class="term-dot" cx="36" cy="-12" r="5"/></svg><span>Wire</span></button>';

    tray.addEventListener('pointerdown', CircuitLab.trayDown);
    // move/up listen on the whole page, so a drag keeps working when the pointer leaves the tray
    document.addEventListener('pointermove', CircuitLab.trayMove);
    document.addEventListener('pointerup', CircuitLab.trayUp);
    document.addEventListener('pointercancel', CircuitLab.trayCancel);
    tray.addEventListener('click', CircuitLab.trayClick);

    const box = UI.byId('circuit-canvas');
    box.addEventListener('pointerdown', CircuitLab.tableDown);
    box.addEventListener('pointermove', CircuitLab.tableMove);
    box.addEventListener('pointerup', CircuitLab.tableUp);
    box.addEventListener('pointercancel', CircuitLab.tableCancel);

    UI.byId('btn-sim').addEventListener('click', CircuitLab.toggleRun);
    UI.byId('btn-rotate').addEventListener('click', CircuitLab.rotateSelected);
    UI.byId('btn-delete').addEventListener('click', CircuitLab.deleteSelected);
    UI.byId('btn-reset-circuit').addEventListener('click', CircuitLab.clearTable);
    UI.byId('btn-preset-series').addEventListener('click', () => CircuitLab.loadPreset('series'));
    UI.byId('btn-preset-parallel').addEventListener('click', () => CircuitLab.loadPreset('parallel'));
    UI.byId('circuit-save-form').addEventListener('submit', (e) => { e.preventDefault(); CircuitLab.save(); });
    UI.byId('btn-load-circuit').addEventListener('click', CircuitLab.loadSelectedDesign);
    UI.byId('circuit-readouts').addEventListener('click', (e) => {
      const row = e.target.closest('[data-select]');
      if (row) CircuitLab.select(row.getAttribute('data-select'), null);
    });
    UI.byId('circuit-controls').addEventListener('input', CircuitLab.onPropertyInput);
    UI.byId('circuit-controls').addEventListener('click', CircuitLab.onPropertyClick);
    document.addEventListener('keydown', CircuitLab.onKey);

    CircuitLab.ready = true;
    window.__lab = CircuitLab; // handy for tests
  },

  onShow() {
    if (!CircuitLab.ready) return;
    if (CircuitLab.design.parts.length === 0 && !CircuitLab.touched) {
      CircuitLab.design = CircuitSolver.preset('series');
      CircuitLab.counter = 100;
    }
    CircuitLab.refreshSavedList();
    CircuitLab.update(true);
    if (!CircuitLab.panned) { CircuitLab.panned = true; CircuitLab.panToParts(); }
  },

  // Theme changed: draw again in the new colours
  redraw() {
    if (!CircuitLab.ready) return;
    CircuitLab.renderTable();
  },

  // ---------- helpers ----------
  partById(id) { return CircuitLab.design.parts.find((p) => p.id === id); },
  newId(prefix) { CircuitLab.counter += 1; return prefix + CircuitLab.counter; },
  say(type, text) { UI.showMessage('circuit-feedback', type, text); },
  fmt(v, unit) { return Utils.formatWithUnit(v, unit); },

  // Mouse/touch position on the table, in table pixels (the SVG is scaled with the screen)
  tablePoint(e) {
    const svg = UI.byId('circuit-canvas').querySelector('svg');
    const r = svg.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (CircuitDraw.COLS * CircuitDraw.CELL / r.width),
      y: (e.clientY - r.top) * (CircuitDraw.ROWS * CircuitDraw.CELL / r.height),
    };
  },
  clampCell(gx, gy) {
    return {
      gx: Math.max(2, Math.min(CircuitDraw.COLS - 2, gx)),
      gy: Math.max(2, Math.min(CircuitDraw.ROWS - 2, gy)),
    };
  },
  nearestTerminal(pt, skip, radius) {
    let best = null, bestD = radius || 16;
    CircuitLab.design.parts.forEach((p) => {
      [0, 1].forEach((t) => {
        if (skip && skip.p === p.id && skip.t === t) return;
        const c = CircuitSolver.terminalCell(p, t);
        const d = Math.hypot(CircuitDraw.px(c.x) - pt.x, CircuitDraw.px(c.y) - pt.y);
        if (d < bestD) { bestD = d; best = { p: p.id, t }; }
      });
    });
    return best;
  },

  // ---------- adding parts ----------
  addPart(type, value, gx, gy) {
    CircuitLab.touched = true;
    const cell = CircuitLab.clampCell(gx, gy);
    const part = { id: CircuitLab.newId('p'), type, gx: cell.gx, gy: cell.gy, rot: 0, value, closed: true };
    CircuitLab.design.parts.push(part);
    CircuitLab.select(part.id, null);
    CircuitLab.update(true);
    return part;
  },

  freeSpot() {
    const parts = CircuitLab.design.parts;
    for (let gy = 6; gy <= 20; gy += 4) {
      for (let gx = 6; gx <= 34; gx += 6) {
        if (!parts.some((p) => Math.abs(p.gx - gx) < 5 && Math.abs(p.gy - gy) < 3)) return { gx, gy };
      }
    }
    return { gx: 20, gy: 12 };
  },

  // Tray: drag onto the table (pointer events: mouse and touch). A plain click/tap/Enter adds at a free spot.
  trayDown(e) {
    const btn = e.target.closest('[data-tray]');
    if (!btn || e.button > 0) return;
    CircuitLab.tray = { index: Number(btn.getAttribute('data-tray')), x0: e.clientX, y0: e.clientY, moved: false, ghost: null, id: e.pointerId };
  },
  trayMove(e) {
    const t = CircuitLab.tray;
    if (!t || e.pointerId !== t.id) return;
    if (!t.moved && Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > 8) {
      t.moved = true;
      const item = CircuitLab.TRAY[t.index];
      t.ghost = document.createElement('div');
      t.ghost.className = 'tray-ghost';
      t.ghost.innerHTML = CircuitDraw.trayIcon(item.type) + '<span>' + Utils.escapeHtml(item.label) + '</span>';
      document.body.appendChild(t.ghost);
    }
    if (t.moved && t.ghost) {
      t.ghost.style.left = e.clientX + 'px';
      t.ghost.style.top = e.clientY + 'px';
    }
  },
  trayUp(e) {
    const t = CircuitLab.tray;
    if (!t || e.pointerId !== t.id) return;
    CircuitLab.tray = null;
    if (t.ghost) t.ghost.remove();
    if (!t.moved) return; // plain click: the click handler adds the part
    CircuitLab.suppressClick = true;
    setTimeout(() => { CircuitLab.suppressClick = false; }, 50);
    const svg = UI.byId('circuit-canvas').querySelector('svg');
    const r = svg.getBoundingClientRect();
    const box = UI.byId('circuit-canvas').getBoundingClientRect();
    const inside = e.clientX >= Math.max(r.left, box.left) && e.clientX <= Math.min(r.right, box.right) &&
      e.clientY >= Math.max(r.top, box.top) && e.clientY <= Math.min(r.bottom, box.bottom);
    if (!inside) { CircuitLab.say('info', 'Drop the part on the table to place it.'); return; }
    const pt = CircuitLab.tablePoint(e);
    const item = CircuitLab.TRAY[t.index];
    CircuitLab.addPart(item.type, item.value, Math.round(pt.x / CircuitDraw.CELL), Math.round(pt.y / CircuitDraw.CELL));
  },
  trayCancel() {
    if (CircuitLab.tray && CircuitLab.tray.ghost) CircuitLab.tray.ghost.remove();
    CircuitLab.tray = null;
  },
  trayClick(e) {
    const wire = e.target.closest('#btn-wire-mode');
    if (wire) {
      CircuitLab.wireMode = !CircuitLab.wireMode;
      wire.setAttribute('aria-pressed', String(CircuitLab.wireMode));
      wire.classList.toggle('active', CircuitLab.wireMode);
      CircuitLab.say('info', CircuitLab.wireMode
        ? 'Wire tool on. Drag from one terminal dot to another to draw a wire. Click the tool again to switch it off.'
        : 'Wire tool off. You can still draw wires by dragging between terminal dots.');
      CircuitLab.renderTable();
      return;
    }
    const btn = e.target.closest('[data-tray]');
    if (!btn || CircuitLab.suppressClick) return;
    const item = CircuitLab.TRAY[Number(btn.getAttribute('data-tray'))];
    const spot = CircuitLab.freeSpot();
    CircuitLab.addPart(item.type, item.value, spot.gx, spot.gy);
    CircuitLab.say('success', item.label + ' added. Drag it into place, press R to rotate, Delete to remove.');
  },

  // ---------- pointer handling on the table ----------
  tableDown(e) {
    if (e.button > 0 || !e.isPrimary) return;
    const box = UI.byId('circuit-canvas');
    const term = e.target.closest('[data-term]');
    const partEl = e.target.closest('[data-part]');
    const wireEl = e.target.closest('[data-wire]');
    if (term) {
      const [p, t] = term.getAttribute('data-term').split(':');
      CircuitLab.drag = { kind: 'wire', from: { p, t: Number(t) }, id: e.pointerId, moved: false };
      box.setPointerCapture(e.pointerId);
      const pt = CircuitLab.tablePoint(e);
      CircuitLab.select(null, null);
      CircuitLab.drag.x0 = pt.x; CircuitLab.drag.y0 = pt.y;
      return;
    }
    if (partEl) {
      const id = partEl.getAttribute('data-part');
      const part = CircuitLab.partById(id);
      const pt = CircuitLab.tablePoint(e);
      CircuitLab.drag = {
        kind: 'part', id: e.pointerId, part: id, moved: false,
        offX: pt.x - CircuitDraw.px(part.gx), offY: pt.y - CircuitDraw.px(part.gy), x0: pt.x, y0: pt.y,
      };
      box.setPointerCapture(e.pointerId);
      CircuitLab.select(id, null);
      return;
    }
    if (wireEl) { CircuitLab.select(null, wireEl.getAttribute('data-wire')); return; }
    CircuitLab.select(null, null);
  },

  tableMove(e) {
    const d = CircuitLab.drag;
    if (!d || e.pointerId !== d.id) return;
    const pt = CircuitLab.tablePoint(e);
    if (Math.hypot(pt.x - d.x0, pt.y - d.y0) > 4) d.moved = true;
    if (d.kind === 'part') {
      const part = CircuitLab.partById(d.part);
      if (!part || !d.moved) return;
      const cell = CircuitLab.clampCell(Math.round((pt.x - d.offX) / CircuitDraw.CELL), Math.round((pt.y - d.offY) / CircuitDraw.CELL));
      if (cell.gx !== part.gx || cell.gy !== part.gy) {
        part.gx = cell.gx; part.gy = cell.gy;
        CircuitLab.update(false);
      }
    } else if (d.kind === 'wire') {
      d.temp = { from: d.from, x: pt.x, y: pt.y };
      d.hover = CircuitLab.nearestTerminal(pt, d.from, 18);
      CircuitLab.renderTable();
    }
  },

  tableUp(e) {
    const d = CircuitLab.drag;
    if (!d || e.pointerId !== d.id) return;
    CircuitLab.drag = null;
    const pt = CircuitLab.tablePoint(e);
    if (d.kind === 'part') {
      const part = CircuitLab.partById(d.part);
      if (part && !d.moved && part.type === 'switch') {
        part.closed = !part.closed;
        CircuitLab.say('info', 'Switch ' + (part.closed ? 'closed' : 'opened') + '.');
        CircuitLab.update(true);
      }
      return;
    }
    if (d.kind === 'wire') {
      const target = CircuitLab.nearestTerminal(pt, d.from, 18);
      if (target) CircuitLab.addWire(d.from, target);
      else CircuitLab.renderTable();
    }
  },

  tableCancel() {
    CircuitLab.drag = null;
    CircuitLab.renderTable();
  },

  addWire(a, b) {
    const dup = CircuitLab.design.wires.some((w) =>
      (w.a.p === a.p && w.a.t === a.t && w.b.p === b.p && w.b.t === b.t) ||
      (w.a.p === b.p && w.a.t === b.t && w.b.p === a.p && w.b.t === a.t));
    if (dup) { CircuitLab.say('info', 'Those two terminals are already joined by a wire.'); CircuitLab.renderTable(); return; }
    CircuitLab.touched = true;
    const wire = { id: CircuitLab.newId('w'), a: { p: a.p, t: a.t }, b: { p: b.p, t: b.t }, route: 'auto' };
    CircuitLab.design.wires.push(wire);
    CircuitLab.select(null, wire.id);
    CircuitLab.update(true);
  },

  // ---------- selection, rotate, delete, keys ----------
  select(partId, wireId) {
    CircuitLab.selPart = partId;
    CircuitLab.selWire = wireId;
    CircuitLab.renderControls();
    CircuitLab.renderTable();
    CircuitLab.renderInfo();
  },

  rotateSelected() {
    const part = CircuitLab.partById(CircuitLab.selPart);
    if (!part) { CircuitLab.say('info', 'Click a part on the table first, then rotate it.'); return; }
    part.rot = ((part.rot || 0) + 1) % 4;
    CircuitLab.update(false);
  },

  deleteSelected() {
    const d = CircuitLab.design;
    if (CircuitLab.selPart) {
      const id = CircuitLab.selPart;
      d.parts = d.parts.filter((p) => p.id !== id);
      d.wires = d.wires.filter((w) => w.a.p !== id && w.b.p !== id);
      CircuitLab.selPart = null;
      CircuitLab.say('info', 'Part and its wires removed.');
    } else if (CircuitLab.selWire) {
      d.wires = d.wires.filter((w) => w.id !== CircuitLab.selWire);
      CircuitLab.selWire = null;
      CircuitLab.say('info', 'Wire removed.');
    } else {
      CircuitLab.say('info', 'Click a part or a wire first, then delete it.');
      return;
    }
    CircuitLab.update(true);
  },

  onKey(e) {
    if (UI.byId('screen-circuit').hidden) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); CircuitLab.deleteSelected(); }
    else if (e.key === 'r' || e.key === 'R') { CircuitLab.rotateSelected(); }
    else if (e.key === 'Escape') { CircuitLab.drag = null; CircuitLab.select(null, null); }
  },

  clearTable() {
    CircuitLab.design = { parts: [], wires: [] };
    CircuitLab.touched = true;
    CircuitLab.designId = null;
    CircuitLab.selPart = null; CircuitLab.selWire = null;
    CircuitLab.running = false;
    CircuitLab.say('info', 'Table cleared. Drag parts from the tray to start again.');
    CircuitLab.update(true);
  },

  loadPreset(name) {
    CircuitLab.design = CircuitSolver.preset(name);
    CircuitLab.counter = 100;
    CircuitLab.touched = true;
    CircuitLab.designId = null;
    CircuitLab.selPart = null; CircuitLab.selWire = null;
    CircuitLab.say('success', (name === 'parallel' ? 'Parallel' : 'Series') + ' preset placed on the table. Press Start to run it.');
    CircuitLab.update(true);
    CircuitLab.panToParts();
  },

  toggleRun() {
    CircuitLab.running = !CircuitLab.running;
    CircuitLab.update(false);
  },

  // On a narrow screen the table scrolls sideways: bring the parts into view
  panToParts() {
    const box = UI.byId('circuit-canvas');
    const parts = CircuitLab.design.parts;
    if (!box || !parts.length || box.scrollWidth <= box.clientWidth + 2) { if (box) box.scrollLeft = 0; return; }
    const scale = box.scrollWidth / (CircuitDraw.COLS * CircuitDraw.CELL);
    const minX = Math.min(...parts.map((p) => p.gx)) - 3;
    box.scrollLeft = Math.max(0, minX * CircuitDraw.CELL * scale);
  },

  // ---------- update + rendering ----------
  update(rebuildControls) {
    CircuitLab.result = CircuitSolver.solve(CircuitLab.design);
    if (rebuildControls) CircuitLab.renderControls();
    CircuitLab.renderTable();
    CircuitLab.renderInfo();
    const sim = UI.byId('btn-sim');
    sim.textContent = CircuitLab.running ? 'Stop simulation' : 'Start simulation';
    sim.setAttribute('aria-pressed', String(CircuitLab.running));
    sim.classList.toggle('btn-primary', !CircuitLab.running);
    sim.classList.toggle('btn-outline-danger', CircuitLab.running);
  },

  renderTable() {
    const box = UI.byId('circuit-canvas');
    if (!box) return;
    const d = CircuitLab.drag;
    const scrollLeft = box.scrollLeft;
    box.innerHTML = CircuitDraw.render(CircuitLab.design, {
      selPart: CircuitLab.selPart, selWire: CircuitLab.selWire,
      running: CircuitLab.running, result: CircuitLab.result,
      temp: d && d.kind === 'wire' ? d.temp : null,
      hover: d && d.kind === 'wire' ? d.hover : null,
      wireMode: CircuitLab.wireMode,
    });
    box.scrollLeft = scrollLeft;
    box.classList.toggle('running', CircuitLab.running);
  },

  statusText() {
    const r = CircuitLab.result;
    if (!CircuitLab.running) {
      if (r.status === 'empty' || r.status === 'nobattery') return { kind: 'info', text: r.message };
      return { kind: 'info', text: 'Simulation is stopped. Press Start simulation to see the current, voltage and power.' };
    }
    const kind = r.status === 'ok' ? 'ok' : (r.status === 'short' || r.status === 'error' ? 'err' : 'warn');
    return { kind, text: r.message };
  },

  renderInfo() {
    const r = CircuitLab.result;
    const names = CircuitDraw.names(CircuitLab.design);
    const st = CircuitLab.statusText();
    const statusEl = UI.byId('circuit-status');
    if (statusEl.dataset.text !== st.text) {
      statusEl.textContent = st.text;
      statusEl.dataset.text = st.text;
    }
    statusEl.className = 'lab-status status-' + st.kind;
    const live = CircuitLab.running;
    let warn = '';
    if (live && r.warnings.length) {
      warn = '<ul class="lab-warnings">' + r.warnings.map((w) => '<li>' + Utils.escapeHtml(w) + '</li>').join('') + '</ul>';
    }
    const rows = CircuitLab.design.parts.map((p) => {
      const res = r.parts[p.id];
      const show = live && (r.status === 'ok' || (r.status === 'open' && p.type === 'voltmeter'));
      const cells = show
        ? '<td>' + Utils.formatWithUnit(Math.abs(res.v), 'V') + '</td><td>' + Utils.formatWithUnit(Math.abs(res.i), 'A') + '</td><td>' + Utils.formatWithUnit(res.p, 'W') + '</td>'
        : '<td>-</td><td>-</td><td>-</td>';
      const sel = CircuitLab.selPart === p.id;
      return '<tr class="' + (sel ? 'row-selected' : '') + '"><th scope="row"><button type="button" class="link-row" data-select="' + p.id + '" aria-label="Select ' +
        CircuitDraw.NAMES[p.type] + ' ' + names[p.id] + '">' + CircuitDraw.NAMES[p.type] + ' ' + names[p.id] + '</button></th>' + cells + '</tr>';
    }).join('');
    let totals = '';
    if (live && r.status === 'ok') {
      totals = '<div class="readout-grid mt-2">' +
        UI.readoutTile('Battery current', Utils.formatWithUnit(r.current, 'A')) +
        UI.readoutTile('Total resistance', r.totalResistance === null ? '-' : Utils.formatWithUnit(r.totalResistance, 'Ω')) +
        UI.readoutTile('Battery power', Utils.formatWithUnit(r.power, 'W')) +
        UI.readoutTile('Circuit type', CircuitSolver.topology(CircuitLab.design)) + '</div>';
    }
    UI.byId('circuit-readouts').innerHTML = warn +
      (rows ? '<div class="lab-info-wrap mt-2"><table class="table table-sm lab-info-table"><caption class="visually-hidden">Voltage, current and power of each part</caption>' +
        '<thead><tr><th scope="col">Part</th><th scope="col">V</th><th scope="col">I</th><th scope="col">P</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="small text-muted-vl mt-2 mb-0">No parts yet.</p>') + totals;
  },

  // Properties of the selected part / wire
  renderControls() {
    const box = UI.byId('circuit-controls');
    const names = CircuitDraw.names(CircuitLab.design);
    const part = CircuitLab.partById(CircuitLab.selPart);
    const wire = CircuitLab.design.wires.find((w) => w.id === CircuitLab.selWire);
    if (part) {
      let field = '';
      if (part.type === 'battery') {
        field = '<label for="prop-value" class="form-label">Battery voltage (V)</label>' +
          '<input type="number" inputmode="decimal" step="any" id="prop-value" class="form-control" value="' + part.value + '" aria-describedby="prop-error">';
      } else if (part.type === 'resistor' || part.type === 'bulb') {
        field = '<label for="prop-value" class="form-label">' + (part.type === 'bulb' ? 'Bulb resistance' : 'Resistance') + ' (Ω)</label>' +
          '<input type="number" inputmode="decimal" step="any" id="prop-value" class="form-control" value="' + part.value + '" aria-describedby="prop-error">';
      } else if (part.type === 'switch') {
        field = '<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="prop-closed"' + (part.closed ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="prop-closed">Switch closed</label></div>';
      } else {
        field = '<p class="small text-muted-vl mb-0">' + CircuitDraw.NAMES[part.type] + 's have no settings. ' +
          (part.type === 'ammeter' ? 'Wire it in series with the part you measure.' : 'Wire it across the part you measure.') + '</p>';
      }
      box.innerHTML = '<p class="mb-2"><strong>' + CircuitDraw.NAMES[part.type] + ' ' + names[part.id] + '</strong> selected</p>' + field +
        '<div class="field-error" id="prop-error" role="alert"></div>';
    } else if (wire) {
      box.innerHTML = '<p class="mb-2"><strong>Wire selected</strong></p>' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" data-act="flip" aria-label="Flip the bend of the selected wire">Flip bend</button>';
    } else {
      box.innerHTML = '<p class="small text-muted-vl mb-0">Click a part or a wire on the table to edit it. Resistance and voltage can be typed here.</p>';
    }
  },

  onPropertyInput(e) {
    const part = CircuitLab.partById(CircuitLab.selPart);
    if (!part) return;
    if (e.target.id === 'prop-closed') {
      part.closed = e.target.checked;
      CircuitLab.update(false);
      return;
    }
    if (e.target.id !== 'prop-value') return;
    const check = part.type === 'battery' ? Validation.validateVoltage(e.target.value) : Validation.validateResistance(e.target.value);
    UI.setFieldError(e.target, 'prop-error', check.message);
    if (!check.ok) return;
    part.value = check.value;
    CircuitLab.update(false);
  },

  onPropertyClick(e) {
    if (e.target.closest('[data-act="flip"]')) {
      const wire = CircuitLab.design.wires.find((w) => w.id === CircuitLab.selWire);
      if (wire) { wire.route = wire.route === 'flip' ? 'auto' : 'flip'; CircuitLab.update(false); }
    }
  },

  // ---------- save / load ----------
  loads() {
    return CircuitLab.design.parts.filter((p) => p.type === 'resistor' || p.type === 'bulb');
  },

  // Hand formula for the expected current (series or parallel); mixed circuits use the solver value
  theoryCurrent(r) {
    const top = CircuitSolver.topology(CircuitLab.design);
    const ohms = CircuitLab.loads().map((p) => Number(p.value));
    if (top === 'series') return Physics.current(r.voltage, Physics.seriesResistance(ohms));
    if (top === 'parallel') return Physics.current(r.voltage, Physics.parallelResistance(ohms));
    return r.current;
  },

  save() {
    const nameInput = UI.byId('circuit-name');
    const nameCheck = Validation.validateName(nameInput.value);
    UI.setFieldError(nameInput, 'circuit-name-error', nameCheck.message);
    if (!nameCheck.ok) return;

    const r = CircuitSolver.solve(CircuitLab.design);
    if (r.status !== 'ok') {
      UI.showMessage('circuit-save-feedback', 'danger', 'This circuit cannot be saved as a result yet. ' + r.message);
      return;
    }
    const d = CircuitLab.design;
    const top = CircuitSolver.topology(d);
    const theory = CircuitLab.theoryCurrent(r);
    const diff = Physics.percentDifference(r.current, theory);
    const sw = d.parts.filter((p) => p.type === 'switch');
    const battery = d.parts.find((p) => p.type === 'battery');
    const result = {
      resultId: Utils.makeId('res'),
      experimentType: 'circuit',
      name: nameCheck.value,
      inputs: {
        topology: top,
        voltage: Number(battery.value),
        resistors: CircuitLab.loads().map((p) => Number(p.value)),
        switchClosed: sw.length ? sw.every((p) => p.closed) : true,
        note: '',
      },
      outputs: {
        totalResistance: Number(r.totalResistance.toFixed(4)),
        current: Number(r.current.toFixed(4)),
        power: Number(r.power.toFixed(4)),
      },
      theoreticalValue: Number(theory.toFixed(4)),
      measuredValue: Number(r.current.toFixed(4)),
      valueLabel: 'Current', unit: 'A',
      status: Physics.statusFromDifference(diff, 2),
      createdAt: new Date().toISOString(),
    };

    const names = CircuitDraw.names(d);
    const design = {
      circuitId: CircuitLab.designId || Utils.makeId('circ'),
      name: nameCheck.value,
      components: {
        topology: top, hasBattery: true, voltage: Number(battery.value),
        switchPresent: sw.length > 0, switchClosed: sw.length ? sw.every((p) => p.closed) : true,
        resistors: CircuitLab.loads().map((p) => ({ id: p.id, ohms: Number(p.value), connected: Math.abs(r.parts[p.id].i) > 1e-9 })),
        wireCount: d.wires.length,
        layout: JSON.parse(JSON.stringify({ parts: d.parts, wires: d.wires })),
      },
      connections: top + ': ' + d.parts.map((p) => names[p.id]).join(', ') + ' joined by ' + d.wires.length + ' wire(s)',
      updatedAt: new Date().toISOString(),
    };
    CircuitLab.designId = design.circuitId;

    const saved = UI.saveResultWithMessage(result, 'circuit-save-feedback');
    const designSaved = Store.saveCircuit(design);
    if (saved && !designSaved.ok) UI.showMessage('circuit-save-feedback', 'warning', designSaved.message);
    if (saved) nameInput.value = '';
    CircuitLab.refreshSavedList();
  },

  refreshSavedList() {
    const select = UI.byId('saved-circuit-select');
    const designs = Store.getCircuits();
    if (designs.length === 0) {
      select.innerHTML = '<option value="">No saved circuits yet</option>';
      return;
    }
    select.innerHTML = designs.map((d) =>
      '<option value="' + Utils.escapeHtml(d.circuitId) + '">' + Utils.escapeHtml(d.name) + '</option>').join('');
  },

  // Old samples only have a resistor list. Build a tidy layout from it.
  layoutFromLegacy(c) {
    const mk = (id, type, gx, gy, rot, value, closed) => ({ id, type, gx, gy, rot, value, closed: closed !== false });
    const parts = [], wires = [];
    let wn = 0;
    const wire = (ap, at, bp, bt) => wires.push({ id: 'w' + (++wn), a: { p: ap, t: at }, b: { p: bp, t: bt }, route: 'auto' });
    const resistors = (c.resistors || []).slice(0, 5);
    const hasBattery = c.hasBattery !== false;
    if (hasBattery) parts.push(mk('b1', 'battery', 6, 10, 3, Number(c.voltage) || 9));
    let source = hasBattery ? { p: 'b1', t: 1 } : null;
    if (c.switchPresent) {
      parts.push(mk('s1', 'switch', 11, 8, 0, 0, c.switchClosed !== false));
      if (source) wire(source.p, source.t, 's1', 0);
      source = { p: 's1', t: 1 };
    }
    if (c.topology === 'parallel') {
      resistors.forEach((r, i) => {
        const id = 'r' + (i + 1);
        parts.push(mk(id, 'resistor', 18 + 8 * i, 10, 1, Number(r.ohms)));
        if (r.connected === false) return;
        if (source) wire(source.p, source.t, id, 0);
        source = { p: id, t: 0 };
        if (hasBattery) wire('b1', 0, id, 1);
      });
    } else {
      let prev = source;
      resistors.forEach((r, i) => {
        const id = 'r' + (i + 1);
        const last = i === resistors.length - 1;
        const x = last ? 17 + 6 * Math.max(0, i - 1) + 5 : 17 + 6 * i;
        parts.push(mk(id, 'resistor', last ? Math.max(x, 16) : x, last ? 10 : 8, last ? 1 : 0, Number(r.ohms)));
        if (r.connected !== false && prev) wire(prev.p, prev.t, id, 0);
        prev = r.connected === false ? null : { p: id, t: last ? 1 : 1 };
        if (last && r.connected !== false && hasBattery) wire(id, 1, 'b1', 0);
      });
    }
    return { parts, wires };
  },

  loadSelectedDesign() {
    const id = UI.byId('saved-circuit-select').value;
    const design = Store.getCircuits().find((x) => x.circuitId === id);
    if (!design || !design.components) {
      UI.showMessage('circuit-feedback', 'warning', 'No saved circuit to load yet. Build one and press Save result.');
      return;
    }
    const c = design.components;
    const layout = c.layout && Array.isArray(c.layout.parts) ? c.layout : CircuitLab.layoutFromLegacy(c);
    CircuitLab.design = JSON.parse(JSON.stringify({ parts: layout.parts, wires: layout.wires || [] }));
    CircuitLab.counter = 100;
    CircuitLab.touched = true;
    CircuitLab.designId = design.circuitId;
    CircuitLab.selPart = null; CircuitLab.selWire = null;
    UI.showMessage('circuit-feedback', 'success', 'Loaded "' + design.name + '". Press Start simulation to run it.');
    CircuitLab.update(true);
    CircuitLab.panToParts();
  },
};


/* ===== js/projectile.js ===== */
// projectile.js
// Projectile Motion screen: inputs check -> simulate -> animate -> compare with theory.

const Projectile = {
  lastRun: null,      // last successful run (Save ke liye)
  animationId: null,  // requestAnimationFrame id
  lastDraw: null,     // last drawing ke arguments (theme badalne par redraw ke liye)

  init() {
    const speed = UI.byId('proj-speed');
    const angle = UI.byId('proj-angle');
    UI.linkRangeAndNumber(UI.byId('proj-speed-range'), speed, () => Projectile.onInputChange());
    UI.linkRangeAndNumber(UI.byId('proj-angle-range'), angle, () => Projectile.onInputChange());
    UI.byId('proj-gravity').addEventListener('change', () => Projectile.onInputChange());
    UI.byId('projectile-form').addEventListener('submit', (e) => { e.preventDefault(); Projectile.run(); });
    UI.byId('proj-reset').addEventListener('click', Projectile.reset);
    UI.byId('proj-save-form').addEventListener('submit', (e) => { e.preventDefault(); Projectile.save(); });
    Projectile.showIdle();
  },

  onShow() {
    if (!Projectile.lastRun) Projectile.showIdle();
  },

  // Theme badla: jo drawing abhi dikh rahi hai use naye rangon mein dobara banao
  // (animation chal rahi ho to agla frame hi naye rang se banega)
  redraw() {
    const d = Projectile.lastDraw;
    const box = UI.byId('proj-canvas');
    if (!d || !box || Projectile.animationId) return;
    box.innerHTML = Projectile.drawScene(d.i, d.th, d.progress);
  },

  // Inputs check karo. Sab theek ho to {ok:true, speed, angle, g}
  readInputs() {
    const speedEl = UI.byId('proj-speed');
    const angleEl = UI.byId('proj-angle');
    const s = Validation.validateSpeed(speedEl.value);
    const a = Validation.validateAngle(angleEl.value);
    UI.setFieldError(speedEl, 'proj-speed-error', s.message);
    UI.setFieldError(angleEl, 'proj-angle-error', a.message);
    return { ok: s.ok && a.ok, speed: s.value, angle: a.value, g: Number(UI.byId('proj-gravity').value) };
  },

  // Input badla: purana result ab match nahi karta
  onInputChange() {
    Projectile.stopAnimation();
    Projectile.lastRun = null;
    const inputs = Projectile.readInputs();
    if (inputs.ok) Projectile.showIdle(inputs);
    else UI.byId('proj-readouts').innerHTML = '<p class="mb-0">Fix the highlighted input to see results.</p>';
  },

  // Run se pehle: sirf theory dikhao aur khali graph
  showIdle(inputs) {
    const i = inputs || Projectile.readInputs();
    if (!i.ok) return;
    const th = Projectile.theory(i);
    UI.byId('proj-canvas').innerHTML = Projectile.drawScene(i, th, null);
    UI.byId('proj-readouts').innerHTML =
      '<p class="mb-2">Press <strong>Run</strong> to launch. Theory values are shown below.</p>' +
      '<div class="readout-grid">' +
      UI.readoutTile('Range (theory)', Utils.formatWithUnit(th.range, 'm')) +
      UI.readoutTile('Time of flight (theory)', Utils.formatWithUnit(th.time, 's')) +
      UI.readoutTile('Max height (theory)', Utils.formatWithUnit(th.height, 'm')) + '</div>';
  },

  theory(i) {
    return {
      range: Physics.projectileRange(i.speed, i.angle, i.g),
      time: Physics.projectileTimeOfFlight(i.speed, i.angle, i.g),
      height: Physics.projectileMaxHeight(i.speed, i.angle, i.g),
    };
  },

  run() {
    const inputs = Projectile.readInputs();
    if (!inputs.ok) {
      UI.showMessage('proj-feedback', 'danger', 'Please fix the highlighted input before running.');
      return;
    }
    UI.clearMessage('proj-feedback');
    Projectile.stopAnimation();

    const th = Projectile.theory(inputs);
    const sim = Physics.simulateProjectile(inputs.speed, inputs.angle, inputs.g);
    Projectile.lastRun = { inputs, theory: th, sim };

    // Animation: asli time bahut lamba/chhota ho sakta hai, isliye 1.5 se 6 second mein dikhate hain
    const seconds = Math.min(6, Math.max(1.5, sim.timeOfFlight));
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = UI.byId('proj-canvas');

    const finish = () => {
      canvas.innerHTML = Projectile.drawScene(inputs, th, 1);
      Projectile.showResults();
    };
    if (reduceMotion) { finish(); return; }

    UI.byId('proj-readouts').innerHTML = '<p class="mb-0">Running…</p>';
    UI.byId('proj-run').disabled = true;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.max(0, Math.min(1, (now - start) / (seconds * 1000)));
      canvas.innerHTML = Projectile.drawScene(inputs, th, progress);
      if (progress < 1) {
        Projectile.animationId = requestAnimationFrame(step);
      } else {
        Projectile.animationId = null;
        UI.byId('proj-run').disabled = false;
        Projectile.showResults();
      }
    };
    Projectile.animationId = requestAnimationFrame(step);
  },

  stopAnimation() {
    if (Projectile.animationId) cancelAnimationFrame(Projectile.animationId);
    Projectile.animationId = null;
    UI.byId('proj-run').disabled = false;
  },

  // Measured vs theory table
  showResults() {
    const run = Projectile.lastRun;
    if (!run) return;
    const rows = [
      ['Range', run.sim.range, run.theory.range, 'm'],
      ['Time of flight', run.sim.timeOfFlight, run.theory.time, 's'],
      ['Max height', run.sim.maxHeight, run.theory.height, 'm'],
    ];
    const diffRange = Physics.percentDifference(run.sim.range, run.theory.range);
    run.status = Physics.statusFromDifference(diffRange, 2);

    const body = rows.map((r) => {
      const d = Physics.percentDifference(r[1], r[2]);
      return '<tr><th scope="row">' + r[0] + '</th><td>' + Utils.formatWithUnit(r[1], r[3]) + '</td><td>' +
        Utils.formatWithUnit(r[2], r[3]) + '</td><td>' + Utils.formatNumber(d, 3) + ' %</td></tr>';
    }).join('');

    UI.byId('proj-readouts').innerHTML =
      '<div class="mb-2">' + UI.statusBadge(run.status) + ' <span class="ms-1">Range difference: ' +
      Utils.formatNumber(diffRange, 3) + ' % (tolerance 2 %)</span></div>' +
      '<div class="readout-grid mb-2">' +
      UI.readoutTile('Range', Utils.formatWithUnit(run.sim.range, 'm')) +
      UI.readoutTile('Time of flight', Utils.formatWithUnit(run.sim.timeOfFlight, 's')) +
      UI.readoutTile('Max height', Utils.formatWithUnit(run.sim.maxHeight, 'm')) + '</div>' +
      '<div class="table-responsive"><table class="table table-sm mb-0"><caption class="visually-hidden">Simulated and theory values</caption>' +
      '<thead><tr><th scope="col">Quantity</th><th scope="col">Simulated</th><th scope="col">Theory</th><th scope="col">Difference</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      '<p class="small mt-2 mb-0">Theory: R = v²·sin(2θ)/g, T = 2v·sinθ/g, H = v²·sin²θ/(2g). No air resistance.</p>';
  },

  // SVG drawing. progress: null = sirf axes, 0..1 = kitna path udaa
  drawScene(i, th, progress) {
    // Rang CSS variables se (theme ke saath badalte hain). Last drawing yaad rakho taaki theme badalne par wahi dobara ban sake.
    Projectile.lastDraw = { i, th, progress };
    const bg = Utils.themeColor('--canvas', '#060b12');
    const axis = Utils.themeColor('--sim-axis', '#9fb4c9');
    const tick = Utils.themeColor('--sim-tick', '#b0c1d2');
    const accent = Utils.themeColor('--accent', '#00f0ff');
    const W = 600, H = 300, left = 50, right = 20, top = 20, bottom = 40;
    const pw = W - left - right, ph = H - top - bottom;
    // Dono axes ko same scale (metres -> pixels) taaki shape asli lage
    const scale = Math.min(pw / Math.max(th.range, 0.01), ph / Math.max(th.height, 0.01));
    const px = (x) => left + x * scale;
    const py = (y) => H - bottom - y * scale;

    // Pura theory path (dotted)
    const pts = [];
    const n = 60;
    for (let k = 0; k <= n; k++) {
      const p = Physics.projectilePosition(i.speed, i.angle, i.g, th.time * k / n);
      pts.push(px(p.x).toFixed(1) + ',' + py(Math.max(0, p.y)).toFixed(1));
    }
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sim-svg" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bg + '"/>' +
      '<line x1="' + left + '" y1="' + (H - bottom) + '" x2="' + (W - right) + '" y2="' + (H - bottom) + '" stroke="' + axis + '" stroke-width="2"/>' +
      '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (H - bottom) + '" stroke="' + axis + '" stroke-width="2"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + axis + '" stroke-width="2" stroke-dasharray="5 5"/>' +
      '<text x="' + (left + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="14" fill="#F3EFE6">Distance (m), range ≈ ' + Utils.formatNumber(th.range, 2) + ' m</text>' +
      '<text x="14" y="' + (top + ph / 2) + '" text-anchor="middle" font-size="14" fill="#F3EFE6" transform="rotate(-90 14 ' + (top + ph / 2) + ')">Height (m)</text>' +
      '<text x="' + left + '" y="' + (H - bottom + 16) + '" text-anchor="middle" font-size="12" fill="' + tick + '">0</text>' +
      '<text x="' + px(th.range) + '" y="' + (H - bottom + 16) + '" text-anchor="middle" font-size="12" fill="' + tick + '">' + Utils.formatNumber(th.range, 1) + '</text>' +
      '<text x="' + (left - 6) + '" y="' + (py(th.height) + 4) + '" text-anchor="end" font-size="12" fill="' + tick + '">' + Utils.formatNumber(th.height, 1) + '</text>';

    if (progress !== null) {
      const t = th.time * progress;
      const trail = [];
      const m = Math.max(2, Math.round(60 * progress));
      for (let k = 0; k <= m; k++) {
        const p = Physics.projectilePosition(i.speed, i.angle, i.g, t * k / m);
        trail.push(px(p.x).toFixed(1) + ',' + py(Math.max(0, p.y)).toFixed(1));
      }
      const now = Physics.projectilePosition(i.speed, i.angle, i.g, t);
      svg += '<polyline points="' + trail.join(' ') + '" fill="none" stroke="' + accent + '" stroke-width="3"/>' +
        '<circle cx="' + px(now.x).toFixed(1) + '" cy="' + py(Math.max(0, now.y)).toFixed(1) + '" r="8" fill="#F3EFE6" stroke="' + bg + '" stroke-width="2"/>';
    } else {
      svg += '<circle cx="' + px(0) + '" cy="' + py(0) + '" r="8" fill="#F3EFE6" stroke="' + bg + '" stroke-width="2"/>';
    }
    return svg + '</svg>';
  },

  reset() {
    Projectile.stopAnimation();
    UI.byId('proj-speed').value = 20; UI.byId('proj-speed-range').value = 20;
    UI.byId('proj-angle').value = 45; UI.byId('proj-angle-range').value = 45;
    UI.byId('proj-gravity').value = '9.81';
    Projectile.lastRun = null;
    Projectile.readInputs();
    UI.clearMessage('proj-feedback');
    Projectile.showIdle();
  },

  save() {
    const nameInput = UI.byId('proj-name');
    const nameCheck = Validation.validateName(nameInput.value);
    UI.setFieldError(nameInput, 'proj-name-error', nameCheck.message);
    if (!nameCheck.ok) return;
    const run = Projectile.lastRun;
    if (!run || !run.status) {
      UI.showMessage('proj-feedback', 'warning', 'Run the experiment first, then save the result.');
      return;
    }
    const result = {
      resultId: Utils.makeId('res'),
      experimentType: 'projectile',
      name: nameCheck.value,
      inputs: { speed: run.inputs.speed, angle: run.inputs.angle, gravity: run.inputs.g },
      outputs: {
        range: Number(run.sim.range.toFixed(4)),
        timeOfFlight: Number(run.sim.timeOfFlight.toFixed(4)),
        maxHeight: Number(run.sim.maxHeight.toFixed(4)),
      },
      theoreticalValue: Number(run.theory.range.toFixed(4)),
      measuredValue: Number(run.sim.range.toFixed(4)),
      valueLabel: 'Range', unit: 'm',
      status: run.status,
      createdAt: new Date().toISOString(),
    };
    if (UI.saveResultWithMessage(result, 'proj-feedback')) nameInput.value = '';
  },
};


/* ===== js/pendulum.js ===== */
// pendulum.js
// Pendulum screen: RK4 simulation se period nikalte hain, formula T = 2*pi*sqrt(L/g) se compare.

const Pendulum = {
  lastRun: null,
  animationId: null,
  lastDraw: null,     // last drawing ke arguments (theme badalne par redraw ke liye)

  init() {
    UI.linkRangeAndNumber(UI.byId('pend-length-range'), UI.byId('pend-length'), () => Pendulum.onInputChange());
    UI.linkRangeAndNumber(UI.byId('pend-angle-range'), UI.byId('pend-angle'), () => Pendulum.onInputChange());
    UI.byId('pend-gravity').addEventListener('change', () => Pendulum.onInputChange());
    UI.byId('pendulum-form').addEventListener('submit', (e) => { e.preventDefault(); Pendulum.run(); });
    UI.byId('pend-reset').addEventListener('click', Pendulum.reset);
    UI.byId('pend-save-form').addEventListener('submit', (e) => { e.preventDefault(); Pendulum.save(); });
    Pendulum.showIdle();
  },

  onShow() {
    if (!Pendulum.lastRun) Pendulum.showIdle();
  },

  // Theme badla: jo drawing abhi dikh rahi hai use naye rangon mein dobara banao
  redraw() {
    const d = Pendulum.lastDraw;
    const box = UI.byId('pend-canvas');
    if (!d || !box || Pendulum.animationId) return;
    box.innerHTML = Pendulum.drawScene(d.i, d.theta);
  },

  readInputs() {
    const lengthEl = UI.byId('pend-length');
    const angleEl = UI.byId('pend-angle');
    const l = Validation.validateLength(lengthEl.value);
    const a = Validation.validatePendulumAngle(angleEl.value);
    UI.setFieldError(lengthEl, 'pend-length-error', l.message);
    UI.setFieldError(angleEl, 'pend-angle-error', a.message);
    return { ok: l.ok && a.ok, length: l.value, angle: a.value, g: Number(UI.byId('pend-gravity').value) };
  },

  onInputChange() {
    Pendulum.stopAnimation();
    Pendulum.lastRun = null;
    const inputs = Pendulum.readInputs();
    if (inputs.ok) Pendulum.showIdle(inputs);
    else UI.byId('pend-readouts').innerHTML = '<p class="mb-0">Fix the highlighted input to see results.</p>';
  },

  showIdle(inputs) {
    const i = inputs || Pendulum.readInputs();
    if (!i.ok) return;
    const theory = Physics.pendulumPeriodTheory(i.length, i.g);
    UI.byId('pend-canvas').innerHTML = Pendulum.drawScene(i, Physics.toRadians(i.angle));
    UI.byId('pend-readouts').innerHTML =
      '<p class="mb-2">Press <strong>Run</strong> to swing the pendulum. Theory value is shown below.</p>' +
      '<div class="readout-grid">' + UI.readoutTile('Period (theory)', theory.toFixed(3) + ' s') + '</div>';
  },

  run() {
    const inputs = Pendulum.readInputs();
    if (!inputs.ok) {
      UI.showMessage('pend-feedback', 'danger', 'Please fix the highlighted input before running.');
      return;
    }
    UI.clearMessage('pend-feedback');
    Pendulum.stopAnimation();

    const theory = Physics.pendulumPeriodTheory(inputs.length, inputs.g);
    const dt = 0.001;
    const seconds = Math.min(15, theory * 3); // 3 swings tak animate
    const sim = Physics.simulatePendulum(inputs.length, inputs.angle, inputs.g, dt, seconds);
    Pendulum.lastRun = { inputs, theory, period: sim.period, status: null };

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = UI.byId('pend-canvas');
    const finish = () => {
      canvas.innerHTML = Pendulum.drawScene(inputs, Physics.toRadians(inputs.angle));
      Pendulum.showResults();
    };
    if (reduceMotion) { finish(); return; }

    UI.byId('pend-readouts').innerHTML = '<p class="mb-0">Swinging…</p>';
    UI.byId('pend-run').disabled = true;
    const start = performance.now();
    const step = (now) => {
      // max(0, ...) : pehle frame mein 'now' kabhi start se chhota hota hai
      const index = Math.max(0, Math.min(sim.samples.length - 1, Math.floor((now - start) / 1000 / dt)));
      canvas.innerHTML = Pendulum.drawScene(inputs, sim.samples[index]);
      if (index < sim.samples.length - 1) {
        Pendulum.animationId = requestAnimationFrame(step);
      } else {
        Pendulum.animationId = null;
        UI.byId('pend-run').disabled = false;
        Pendulum.showResults();
      }
    };
    Pendulum.animationId = requestAnimationFrame(step);
  },

  stopAnimation() {
    if (Pendulum.animationId) cancelAnimationFrame(Pendulum.animationId);
    Pendulum.animationId = null;
    UI.byId('pend-run').disabled = false;
  },

  showResults() {
    const run = Pendulum.lastRun;
    if (!run) return;
    const diff = Physics.percentDifference(run.period, run.theory);
    run.status = Physics.statusFromDifference(diff, 2);
    const note = run.status === 'Matched' ? '' :
      '<p class="mt-2 mb-0"><strong>Why the difference?</strong> The formula T = 2π√(L/g) is only accurate for small angles (about 10° or less). ' +
      'Try a smaller start angle and run again.</p>';
    UI.byId('pend-readouts').innerHTML =
      '<div class="mb-2">' + UI.statusBadge(run.status) + ' <span class="ms-1">Difference: ' +
      Utils.formatNumber(diff, 3) + ' % (tolerance 2 %)</span></div>' +
      '<div class="readout-grid">' +
      UI.readoutTile('Period (simulated)', run.period.toFixed(3) + ' s') +
      UI.readoutTile('Period (theory)', run.theory.toFixed(3) + ' s') +
      UI.readoutTile('Difference', Utils.formatNumber(diff, 3) + ' %') + '</div>' + note +
      '<p class="small mt-2 mb-0">Theory: T = 2π√(L/g). No air resistance, string has no mass.</p>';
  },

  // SVG: pivot upar, bob niche. theta radians (0 = seedha neeche)
  drawScene(i, theta) {
    // Rang CSS variables se (theme ke saath badalte hain). Last drawing yaad rakho taaki theme badalne par wahi dobara ban sake.
    Pendulum.lastDraw = { i, theta };
    const bg = Utils.themeColor('--canvas', '#060b12');
    const axis = Utils.themeColor('--sim-axis', '#9fb4c9');
    const string = Utils.themeColor('--sim-string', '#8aa0b6');
    const accent = Utils.themeColor('--accent', '#00f0ff');
    const W = 600, H = 300, pivotX = W / 2, pivotY = 24;
    const stringPx = 230 * (0.35 + 0.65 * (i.length / 5)); // length ke saath thoda lamba dikhe
    const bx = pivotX + stringPx * Math.sin(theta);
    const by = pivotY + stringPx * Math.cos(theta);
    // Start angle ka halka guide
    const sa = Physics.toRadians(i.angle);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="sim-svg" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bg + '"/>' +
      '<line x1="' + (pivotX - 70) + '" y1="' + pivotY + '" x2="' + (pivotX + 70) + '" y2="' + pivotY + '" stroke="' + axis + '" stroke-width="5"/>' +
      '<line x1="' + pivotX + '" y1="' + pivotY + '" x2="' + pivotX + '" y2="' + (pivotY + stringPx) + '" stroke="' + string + '" stroke-width="2" stroke-dasharray="4 4"/>' +
      '<line x1="' + pivotX + '" y1="' + pivotY + '" x2="' + (pivotX + stringPx * Math.sin(sa)).toFixed(1) + '" y2="' + (pivotY + stringPx * Math.cos(sa)).toFixed(1) + '" stroke="' + string + '" stroke-width="2" stroke-dasharray="4 4"/>' +
      '<line x1="' + pivotX + '" y1="' + pivotY + '" x2="' + bx.toFixed(1) + '" y2="' + by.toFixed(1) + '" stroke="#F3EFE6" stroke-width="3"/>' +
      '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="18" fill="' + accent + '" stroke="' + bg + '" stroke-width="2"/>' +
      '<circle cx="' + pivotX + '" cy="' + pivotY + '" r="5" fill="#F3EFE6"/>' +
      '<text x="16" y="' + (H - 14) + '" font-size="14" fill="#F3EFE6">L = ' + Utils.formatNumber(i.length, 2) + ' m, start angle ' + Utils.formatNumber(i.angle, 1) + '°</text>' +
      '</svg>';
  },

  reset() {
    Pendulum.stopAnimation();
    UI.byId('pend-length').value = 1; UI.byId('pend-length-range').value = 1;
    UI.byId('pend-angle').value = 10; UI.byId('pend-angle-range').value = 10;
    UI.byId('pend-gravity').value = '9.81';
    Pendulum.lastRun = null;
    Pendulum.readInputs();
    UI.clearMessage('pend-feedback');
    Pendulum.showIdle();
  },

  save() {
    const nameInput = UI.byId('pend-name');
    const nameCheck = Validation.validateName(nameInput.value);
    UI.setFieldError(nameInput, 'pend-name-error', nameCheck.message);
    if (!nameCheck.ok) return;
    const run = Pendulum.lastRun;
    if (!run || !run.status) {
      UI.showMessage('pend-feedback', 'warning', 'Run the experiment first, then save the result.');
      return;
    }
    const result = {
      resultId: Utils.makeId('res'),
      experimentType: 'pendulum',
      name: nameCheck.value,
      inputs: { length: run.inputs.length, startAngle: run.inputs.angle, gravity: run.inputs.g },
      outputs: { period: Number(run.period.toFixed(4)) },
      theoreticalValue: Number(run.theory.toFixed(4)),
      measuredValue: Number(run.period.toFixed(4)),
      valueLabel: 'Period', unit: 's',
      status: run.status,
      createdAt: new Date().toISOString(),
    };
    if (UI.saveResultWithMessage(result, 'pend-feedback')) nameInput.value = '';
  },
};


/* ===== js/results.js ===== */
// results.js
// Results screen (ResultsTable) + Result detail + CSV export.

const Results = {
  filters: { search: '', type: 'all', status: 'all', sort: 'newest' },
  visibleRows: [],  // jo rows abhi screen par hain (CSV isi se banta hai)

  init() {
    const form = UI.byId('filter-form');
    const search = UI.byId('filter-search');
    search.addEventListener('input', () => { Results.filters.search = search.value; Results.render(); });
    ['type', 'status', 'sort'].forEach((name) => {
      const el = UI.byId('filter-' + name);
      el.addEventListener('change', () => { Results.filters[name] = el.value; Results.render(); });
    });
    UI.byId('filter-reset').addEventListener('click', Results.resetFilters);
    form.addEventListener('submit', (e) => e.preventDefault());
    UI.byId('btn-export-csv').addEventListener('click', Results.exportCsv);

    // Table ke andar View / delete clicks
    UI.byId('results-body').addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-id]');
      if (!row || event.target.closest('a')) return;
      location.hash = '#result/' + encodeURIComponent(row.dataset.id);
    });
  },

  onShow() {
    Results.render();
  },

  resetFilters() {
    Results.filters = { search: '', type: 'all', status: 'all', sort: 'newest' };
    UI.byId('filter-search').value = '';
    UI.byId('filter-type').value = 'all';
    UI.byId('filter-status').value = 'all';
    UI.byId('filter-sort').value = 'newest';
    Results.render();
  },

  // Filter + sort lagao
  applyFilters(list) {
    const f = Results.filters;
    const q = f.search.trim().toLowerCase();
    let rows = list.filter((r) =>
      (q === '' || String(r.name).toLowerCase().includes(q)) &&
      (f.type === 'all' || r.experimentType === f.type) &&
      (f.status === 'all' || r.status === f.status));
    const byDate = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));
    if (f.sort === 'newest') rows.sort((a, b) => byDate(b, a));
    else if (f.sort === 'oldest') rows.sort(byDate);
    else if (f.sort === 'name') rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (f.sort === 'status') rows.sort((a, b) => String(a.status).localeCompare(String(b.status)) || byDate(b, a));
    return rows;
  },

  emptyStateHtml() {
    return '<div class="state-box text-center">' +
      '<p class="h5">Nothing saved yet</p>' +
      '<p>Run a lab and press Save. It will show up here.</p>' +
      '<a class="btn btn-primary me-2" href="#circuit">Open Circuit Lab</a>' +
      '<button type="button" class="btn btn-outline-primary" data-action="load-samples">Load sample data</button>' +
      '</div>';
  },

  // Empty state ke button ko kaam karwao
  bindEmptyState(container) {
    const button = container.querySelector('[data-action="load-samples"]');
    if (!button) return;
    button.addEventListener('click', () => {
      const outcome = Store.resetSampleData();
      if (outcome.ok) UI.showMessage('global-feedback', 'success', 'Sample data loaded.');
      else UI.showMessage('global-feedback', 'danger', outcome.message);
      App.refreshCurrent();
    });
  },

  render() {
    const all = Store.getResults();
    const body = UI.byId('results-body');
    const count = UI.byId('results-count');
    const exportBtn = UI.byId('btn-export-csv');

    if (all.length === 0) {
      Results.visibleRows = [];
      count.textContent = '0 results';
      exportBtn.disabled = true;
      body.innerHTML = Results.emptyStateHtml();
      Results.bindEmptyState(body);
      return;
    }

    const rows = Results.applyFilters(all);
    Results.visibleRows = rows;
    count.textContent = 'Showing ' + rows.length + ' of ' + all.length + ' results';
    exportBtn.disabled = rows.length === 0;

    if (rows.length === 0) {
      body.innerHTML = '<div class="state-box text-center"><p class="h5">No matching results</p>' +
        '<p>Nothing matches that. Try another word or clear the filters.</p>' +
        '<button type="button" class="btn btn-outline-primary" id="btn-clear-filters">Clear filters</button></div>';
      UI.byId('btn-clear-filters').addEventListener('click', Results.resetFilters);
      return;
    }

    body.innerHTML = '<div class="table-responsive results-wrap"><table class="table table-hover align-middle results-table">' +
      '<caption class="visually-hidden">Saved results</caption>' +
      '<thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Result</th>' +
      '<th scope="col">Status</th><th scope="col" class="d-none d-md-table-cell">Saved</th><th scope="col"><span class="visually-hidden">Open</span></th></tr></thead><tbody>' +
      rows.map((r) =>
        '<tr data-id="' + Utils.escapeHtml(r.resultId) + '">' +
        '<th scope="row">' + Utils.escapeHtml(r.name) + '</th>' +
        '<td>' + UI.typeLabel(r.experimentType) + '</td>' +
        '<td>' + Utils.escapeHtml(r.valueLabel) + ': ' + Utils.formatWithUnit(r.measuredValue, r.unit) + '</td>' +
        '<td>' + UI.statusBadge(r.status) + '</td>' +
        '<td class="d-none d-md-table-cell">' + UI.formatDate(r.createdAt) + '</td>' +
        '<td><a class="btn btn-sm btn-outline-primary" href="#result/' + encodeURIComponent(r.resultId) +
        '" aria-label="View details of ' + Utils.escapeHtml(r.name) + '">View</a></td></tr>').join('') +
      '</tbody></table></div>';
  },

  // ---------- Detail ----------

  // Input / output ke naam padhne layak banao
  labels: {
    topology: 'Circuit type', voltage: 'Battery voltage (V)', resistors: 'Resistors (Ω)', switchClosed: 'Switch closed',
    note: 'Note', speed: 'Launch speed (m/s)', angle: 'Launch angle (°)', gravity: 'Gravity (m/s²)',
    length: 'Length (m)', startAngle: 'Start angle (°)',
    totalResistance: 'Total resistance (Ω)', current: 'Current (A)', power: 'Power (W)',
    range: 'Range (m)', timeOfFlight: 'Time of flight (s)', maxHeight: 'Max height (m)', period: 'Period (s)',
  },

  definitionList(obj) {
    const entries = Object.keys(obj || {}).filter((k) => obj[k] !== '' && obj[k] !== undefined);
    if (entries.length === 0) return '<p class="mb-0">None.</p>';
    return '<dl class="row mb-0">' + entries.map((k) => {
      let v = obj[k];
      if (Array.isArray(v)) v = v.join(', ');
      else if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
      return '<dt class="col-7 col-sm-6">' + Utils.escapeHtml(Results.labels[k] || k) + '</dt><dd class="col-5 col-sm-6">' +
        Utils.escapeHtml(String(v)) + '</dd>';
    }).join('') + '</dl>';
  },

  showDetail(resultId) {
    const body = UI.byId('detail-body');
    const r = Store.getResult(resultId);
    if (!r) {
      body.innerHTML = '<div class="state-box text-center"><p class="h5">Result not found</p>' +
        '<p>This result may have been deleted.</p><a class="btn btn-primary" href="#results">Back to Results</a></div>';
      return;
    }
    const diff = Physics.percentDifference(r.measuredValue, r.theoreticalValue);
    body.innerHTML =
      '<div class="card mb-3"><div class="card-body">' +
      '<h2 class="h4">' + Utils.escapeHtml(r.name) + '</h2>' +
      '<p class="mb-2">' + UI.typeLabel(r.experimentType) + ' · saved ' + UI.formatDate(r.createdAt) + '</p>' +
      '<div class="mb-3">' + UI.statusBadge(r.status) + '</div>' +
      '<div class="readout-grid">' +
      UI.readoutTile(r.valueLabel + ' (measured)', Utils.formatWithUnit(r.measuredValue, r.unit)) +
      UI.readoutTile(r.valueLabel + ' (theory)', Utils.formatWithUnit(r.theoreticalValue, r.unit)) +
      UI.readoutTile('Difference', Utils.formatNumber(diff, 3) + ' %') + '</div></div></div>' +
      '<div class="row g-3"><div class="col-md-6"><div class="card h-100"><div class="card-body"><h3 class="h5">Inputs</h3>' +
      Results.definitionList(r.inputs) + '</div></div></div>' +
      '<div class="col-md-6"><div class="card h-100"><div class="card-body"><h3 class="h5">Outputs</h3>' +
      Results.definitionList(r.outputs) + '</div></div></div></div>' +
      '<div id="detail-feedback" class="mt-3" aria-live="polite"></div>' +
      '<div class="mt-3" id="detail-actions"><button type="button" class="btn btn-outline-danger" id="btn-delete-result">Delete this result</button></div>';

    UI.byId('btn-delete-result').addEventListener('click', () => Results.askDelete(r));
  },

  // Delete se pehle confirm (inline, popup nahi)
  askDelete(r) {
    UI.byId('detail-actions').innerHTML =
      '<div class="alert alert-warning mb-0" role="alert"><strong>Warning:</strong> Delete "' + Utils.escapeHtml(r.name) +
      '"? This cannot be undone.<div class="mt-2 d-flex gap-2">' +
      '<button type="button" class="btn btn-danger" id="btn-confirm-delete">Yes, delete</button>' +
      '<button type="button" class="btn btn-outline-secondary" id="btn-cancel-delete">Cancel</button></div></div>';
    UI.byId('btn-confirm-delete').focus();
    UI.byId('btn-cancel-delete').addEventListener('click', () => Results.showDetail(r.resultId));
    UI.byId('btn-confirm-delete').addEventListener('click', () => {
      const outcome = Store.deleteResult(r.resultId);
      if (outcome.ok) {
        UI.showMessage('results-feedback', 'success', 'Result "' + r.name + '" deleted.');
      } else {
        UI.showMessage('results-feedback', 'danger', outcome.message);
      }
      location.hash = '#results';
    });
  },

  // ---------- CSV export (teacher only) ----------

  exportCsv() {
    if (!Roles.require('CSV export')) return;
    const rows = Results.visibleRows;
    if (rows.length === 0) {
      UI.showMessage('results-feedback', 'warning', 'There are no results to export.');
      return;
    }
    const headers = ['Name', 'Experiment', 'Measured', 'Theory', 'Unit', 'Difference %', 'Status', 'Saved at'];
    const data = rows.map((r) => [
      r.name, UI.typeLabel(r.experimentType), r.measuredValue, r.theoreticalValue, r.unit,
      Number(Physics.percentDifference(r.measuredValue, r.theoreticalValue).toFixed(3)), r.status, r.createdAt,
    ]);
    const csv = '﻿' + Utils.toCsv(headers, data); // BOM: Excel mein sahi khulta hai
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'virtuallab-results.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      UI.showMessage('results-feedback', 'success', 'Exported ' + rows.length + ' rows to virtuallab-results.csv.');
    } catch (error) {
      UI.showMessage('results-feedback', 'danger', 'The CSV file could not be created in this browser.');
    }
  },
};


/* ===== js/teacher.js ===== */
// teacher.js
// Teacher Review screen: summary + "Needs repeat" list + sample data reload.
// Student view mein ye screen khulti hi nahi (app.js guard karta hai).

const Teacher = {
  onShow() {
    const results = Store.getResults();
    const box = UI.byId('teacher-body');
    const byType = { circuit: 0, projectile: 0, pendulum: 0 };
    results.forEach((r) => { if (r.experimentType in byType) byType[r.experimentType] += 1; });
    const repeat = results.filter((r) => r.status !== 'Matched');
    const matched = results.length - repeat.length;

    const repeatHtml = repeat.length === 0
      ? '<p class="mb-0">Nothing needs repeating right now.</p>'
      : '<ul class="list-group">' + repeat.map((r) =>
        '<li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">' +
        '<span><a href="#result/' + encodeURIComponent(r.resultId) + '">' + Utils.escapeHtml(r.name) + '</a> ' +
        '<span class="text-muted-vl small">(' + UI.typeLabel(r.experimentType) + ')</span></span>' +
        UI.statusBadge(r.status) + '</li>').join('') + '</ul>';

    box.innerHTML =
      '<div class="readout-grid mb-3">' +
      UI.readoutTile('Total results', String(results.length)) +
      UI.readoutTile('Matched', String(matched)) +
      UI.readoutTile('Needs repeat', String(repeat.length)) +
      UI.readoutTile('Circuit / Projectile / Pendulum', byType.circuit + ' / ' + byType.projectile + ' / ' + byType.pendulum) +
      '</div>' +
      '<div class="card mb-3"><div class="card-body"><h2 class="h5">Needs repeat</h2>' + repeatHtml + '</div></div>' +
      '<div class="card"><div class="card-body"><h2 class="h5">Sample data</h2>' +
      '<p>Reload the sample circuits and results. This replaces everything saved in this browser.</p>' +
      '<div id="teacher-feedback" aria-live="polite" class="mb-2"></div>' +
      '<div id="teacher-reset-area"><button type="button" class="btn btn-outline-danger" id="btn-reload-samples">Reload sample data</button></div>' +
      '</div></div>';

    UI.byId('btn-reload-samples').addEventListener('click', Teacher.askReload);
  },

  askReload() {
    UI.byId('teacher-reset-area').innerHTML =
      '<div class="alert alert-warning mb-0" role="alert"><strong>Warning:</strong> This will replace all saved results and circuits with the sample data.' +
      '<div class="mt-2 d-flex gap-2"><button type="button" class="btn btn-danger" id="btn-confirm-reload">Yes, replace</button>' +
      '<button type="button" class="btn btn-outline-secondary" id="btn-cancel-reload">Cancel</button></div></div>';
    UI.byId('btn-confirm-reload').focus();
    UI.byId('btn-cancel-reload').addEventListener('click', Teacher.onShow);
    UI.byId('btn-confirm-reload').addEventListener('click', () => {
      if (!Roles.require('Reloading sample data')) return;
      const outcome = Store.resetSampleData();
      Teacher.onShow();
      if (outcome.ok) UI.showMessage('teacher-feedback', 'success', 'Sample data reloaded.');
      else UI.showMessage('teacher-feedback', 'danger', outcome.message);
    });
  },
};


/* ===== js/app.js ===== */
// app.js
// Sabse last chalne wali file: app start, hash router, role switch.
// Routes: #dashboard #circuit #projectile #pendulum #results #result/<id> #teacher #help

const App = {
  screens: ['dashboard', 'circuit', 'projectile', 'pendulum', 'results', 'detail', 'teacher', 'help'],
  titles: {
    dashboard: 'Lab Dashboard', circuit: 'Circuit Lab', projectile: 'Projectile Motion', pendulum: 'Simple Pendulum',
    results: 'Results', detail: 'Result detail', teacher: 'Teacher Review', help: 'How it works',
  },
  currentScreen: '',

  start() {
    // Loading state thodi der dikhao, phir app kholo
    let reloaded = false;
    try { reloaded = Store.ensureSampleData(); } catch (e) { /* storage band ho to memory use hoti hai */ }

    Roles.apply();

    // Colour theme: swatches ko jodo, aur theme badalte hi drawings naye rangon mein dobara banao
    ThemeManager.init();
    document.addEventListener('themechange', () => {
      try { CircuitLab.redraw(); } catch (e) { /* ek drawing fail ho to baaki chalein */ }
      try { Projectile.redraw(); } catch (e) { /* same */ }
      try { Pendulum.redraw(); } catch (e) { /* same */ }
    });
    UI.byId('role-select').addEventListener('change', (e) => {
      Roles.set(e.target.value);
      App.route(); // role badla to current screen dobara check karo
    });

    CircuitLab.init();
    Projectile.init();
    Pendulum.init();
    Results.init();
    window.addEventListener('hashchange', App.route);

    window.setTimeout(() => {
      UI.byId('app-loading').hidden = true;
      if (Store.lastProblem) UI.showMessage('global-feedback', 'danger', Store.lastProblem);
      else if (reloaded) UI.showMessage('global-feedback', 'info', 'Some sample circuits and results are already here so you can look around. Your own runs are saved in this browser.');
      App.route();
    }, 350);
  },

  // Hash padho aur screen dikhao
  route() {
    const hash = (location.hash || '#dashboard').replace('#', '');
    let name = hash.split('/')[0];
    let detailId = '';
    if (name === 'result') { name = 'detail'; detailId = decodeURIComponent(hash.split('/')[1] || ''); }
    if (!App.screens.includes(name)) name = 'dashboard';

    // Teacher screen student ke liye band
    if (name === 'teacher' && !Roles.isTeacher()) {
      UI.showMessage('global-feedback', 'warning', 'Teacher Review is only available in Teacher view. Switch "View as" to Teacher to open it.');
      location.hash = '#dashboard';
      return;
    }
    App.show(name, detailId);
  },

  show(name, detailId) {
    App.screens.forEach((s) => { UI.byId('screen-' + s).hidden = s !== name; });
    const changed = App.currentScreen !== name + detailId;
    App.currentScreen = name + detailId;

    if (name === 'dashboard') Dashboard.render();
    if (name === 'circuit') CircuitLab.onShow();
    if (name === 'projectile') Projectile.onShow();
    if (name === 'pendulum') Pendulum.onShow();
    if (name === 'results') Results.onShow();
    if (name === 'detail') Results.showDetail(detailId);
    if (name === 'teacher') Teacher.onShow();

    // Navbar: current page mark karo
    const navName = name === 'detail' ? 'results' : name;
    document.querySelectorAll('[data-screen]').forEach((link) => {
      if (link.dataset.screen === navName) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = App.titles[name] + ' - VirtualLab Simulator';

    // Last used experiment yaad rakho (Dashboard "Continue" ke liye)
    if (['circuit', 'projectile', 'pendulum'].includes(name)) {
      const prefs = Store.getPrefs();
      prefs.lastExperiment = name;
      Store.savePrefs(prefs);
    }

    // Mobile menu band karo
    const nav = UI.byId('main-nav');
    if (nav && nav.classList.contains('show')) nav.classList.remove('show');

    // Screen reader aur keyboard ke liye heading par focus
    if (changed) {
      const heading = document.querySelector('#screen-' + name + ' h1');
      if (heading) heading.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  },

  // Data badalne ke baad current screen dobara draw karo
  refreshCurrent() {
    App.route();
  },
};

document.addEventListener('DOMContentLoaded', App.start);


