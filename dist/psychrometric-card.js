/**
 * Psychrometric Chart Card for Home Assistant
 * Based on https://github.com/jbsky/Psychrometrique
 * Renders a psychrometric diagram with live HA sensor data points
 * Interactive legend: click to enable/disable individual points
 * Click on chart points to show detail / 2-point comparison
 */

const POINT_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
  '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
  '#8bc34a', '#cddc39', '#ffc107', '#ff9800', '#ff5722',
  '#795548', '#607d8b'
];

// ===== Auto-discovery =====
// Words that name the quantity rather than the thing being measured. Stripping them
// from an entity_id leaves a signature that a temperature and a humidity sensor of the
// same room share, which is what pass 2 below matches on.
const QUANTITY_WORDS = /^(temperature|temperatures|temp|humidite|humidity|hum|rh|sensor)$/;
// Integrations that compute psychrometry from a thermometer and a hygrometer. Their dew
// point carries device_class: temperature, so left alone it comes back in as a measurement
// and pairs with the very humidity sensor it was derived from -- a point on the chart that
// is really the chart's own output. Anything else of the kind goes in `exclude`.
const DERIVED_PLATFORMS = /^(psychrometrics|thermal_comfort)$/;
// Longest label a legend cell holds without truncating at the widths this card is used at.
const MAX_LABEL = 32;
// Whether the sensor list under the chart is folded. Shared by every card on the origin:
// one preference about how much of the page this card takes up, not a per-card setting.
const PANEL_STORAGE_KEY = 'psychro-card-panel';
// Words that name the instrument or the quantity rather than the place. A device called
// "Thermometre Alexandre" is Alexandre's room; "Temperature RdC" is the ground floor. Both
// ends of the name are trimmed, because integrations disagree about which end they use.
const LABEL_NOISE = /^[\s\-_]*(thermom[\u00e8e]tre|thermometer|hygrom[\u00e8e]tre|capteur|sonde|sensor|temp[\u00e9e]rature|temp|humidit[\u00e9e]|humidity)[\s\-_]+|[\s\-_]+(temp[\u00e9e]rature|temp|humidit[\u00e9e]|humidity)[\s\-_]*$/gi;

// ===== Psychrometric Calculations =====
class PsychroCalc {
  constructor() {
    this.KB = 1.38064852e-23;
    this.NA = 6.02214085774e23;
    this.Rgas = this.KB * this.NA;
    this.MassMolaireAir = 0.028964;
    this.MassMolaireEau = 0.01801;
    this.RapportMolaireEauSurAir = this.MassMolaireEau / this.MassMolaireAir;
    this.Pression = 101325;
  }

  calcPvs(T) {
    let Pvs = 8.07131 - 1730.63 / (233.426 + T);
    if (T > 99 && T <= 374) Pvs = 8.14019 - 1810.94 / (244.485 + T);
    return Math.pow(10, Pvs) / 0.0075;
  }

  calcTfromPvs(Pvs) {
    return 1730.63 / (8.07131 - Math.log10(Pvs * 0.0075)) - 233.426;
  }

  calcR(HR, T, P) {
    if (P === undefined) P = this.Pression;
    const Pvs = this.calcPvs(T);
    const Pv = (HR / 100) * Pvs;
    return this.RapportMolaireEauSurAir * Pv / (P - Pv);
  }

  calcHR(R, T, P) {
    if (P === undefined) P = this.Pression;
    return 100 * (P * R / (this.RapportMolaireEauSurAir + R)) / this.calcPvs(T);
  }

  Cpa(T) { return 1.00567 + 1.6035e-5 * (T || 20); }
  Cpv(T) { return 1.835 - 7.34e-4 * (T || 20); }

  calcEnthalpie(T, r) {
    return this.Cpa(T) * T + r * (2501.6 + this.Cpv(T) * T);
  }

  calcTsecDepuisEnthalpie(Enthalpie, r) {
    return (Enthalpie - r * 2501.6) / (this.Cpa() + this.Cpv() * r);
  }

  calcPvFromRHR(R, HR, P) {
    if (P === undefined) P = this.Pression;
    return P / (this.RapportMolaireEauSurAir * HR / (100 * R) + HR / 100);
  }

  calcTr(HR, T) {
    if (T < 0 || T > 60 || HR < 0.01 || HR > 100) return null;
    const a = 17.27, b = 237.7;
    const alpha = a * T / (b + T) + Math.log(HR / 100);
    return b * alpha / (a - alpha);
  }
}

// ===== Chart Renderer =====
class PsychroChart {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.calc = new PsychroCalc();
    this.config = config || {};

    this.Xmin = config.temp_min !== undefined ? config.temp_min : -5;
    this.Xmax = config.temp_max !== undefined ? config.temp_max : 45;
    this.Ymin = 0;
    this.Ymax = config.humidity_max !== undefined ? config.humidity_max : 25;

    this.dark_mode = config.dark_mode !== undefined ? config.dark_mode : true;

    // Fond du canvas. Par defaut on ne peint rien : la <ha-card> porte deja le
    // fond du theme, verre translucide compris. Un fillRect opaque ici le
    // masque, et aucune CSS ne peut le rattraper (ce sont des pixels de canvas,
    // pas du DOM). `background: '#1c1c1e'` restaure l'ancien fond plein.
    this.background = config.background !== undefined ? config.background : 'transparent';

    // Repli quand le theme n'expose pas la variable CSS correspondante.
    this.fallback = {
      text: config.dark_mode ? '#cccccc' : '#333333',
      point_stroke: config.dark_mode ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.85)',
    };

    this.colors = {
      background: this.background,
      grid: this.fallback.text,
      text: this.fallback.text,
      point_stroke: this.fallback.point_stroke,
      saturation: config.dark_mode ? '#ff6b6b' : '#d32f2f',
      hr_lines: config.dark_mode ? '#ff8a80' : '#e57373',
      enthalpy_lines: config.dark_mode ? '#ffab40' : '#f57c00',
      comfort_zone: config.dark_mode ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.1)',
    };
    // La grille reprend la couleur du texte, diluee au trace.
    this.gridAlpha = 0.18;

    this.margin = { top: 10, right: 25, bottom: 20, left: 5 };
    this.logicalWidth = 900;
    this.logicalHeight = config.height || 450;
  }

  get width() { return this.logicalWidth - this.margin.left - this.margin.right; }
  get height() { return this.logicalHeight - this.margin.top - this.margin.bottom; }

  toCanvasX(T) {
    return this.margin.left + (T - this.Xmin) / (this.Xmax - this.Xmin) * this.width;
  }

  toCanvasY(R) {
    return this.logicalHeight - this.margin.bottom - (R - this.Ymin) / (this.Ymax - this.Ymin) * this.height;
  }

  // Les proprietes CSS personnalisees traversent les frontieres de shadow DOM
  // par heritage : le canvas voit donc les variables posees par le theme sur
  // <html> / <ha-card>. Relu a chaque trace pour suivre un changement de theme
  // sans reconstruire la carte.
  readThemeColors() {
    let cs = null;
    try { cs = this.canvas ? getComputedStyle(this.canvas) : null; } catch (e) { cs = null; }
    const v = cs ? cs.getPropertyValue('--primary-text-color').trim() : '';
    this.colors.text = v || this.fallback.text;
    // Pas --divider-color : il vaut rgba(0,0,0,.12) dans les themes clairs de
    // HA et disparaitrait sur une photo sombre.
    this.colors.grid = this.colors.text;
  }

  draw(points) {
    const ctx = this.ctx;
    this.readThemeColors();
    ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    const bg = this.colors.background;
    if (bg && bg !== 'transparent' && bg !== 'none') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    }

    this.drawComfortZone();
    this.drawGrid();
    this.drawHRCurves();
    this.drawEnthalpyLines();
    this.drawAxes();
    this.drawPoints(points);
  }

  drawComfortZone() {
    const ctx = this.ctx;
    const comfortTemp = [20, 26];
    const comfortHR = [40, 60];

    ctx.fillStyle = this.colors.comfort_zone;
    ctx.beginPath();
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const T = comfortTemp[0] + (comfortTemp[1] - comfortTemp[0]) * i / steps;
      const R = this.calc.calcR(comfortHR[0], T) * 1000;
      if (i === 0) ctx.moveTo(this.toCanvasX(T), this.toCanvasY(R));
      else ctx.lineTo(this.toCanvasX(T), this.toCanvasY(R));
    }
    for (let i = steps; i >= 0; i--) {
      const T = comfortTemp[0] + (comfortTemp[1] - comfortTemp[0]) * i / steps;
      const R = this.calc.calcR(comfortHR[1], T) * 1000;
      ctx.lineTo(this.toCanvasX(T), this.toCanvasY(R));
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = this.dark_mode ? 'rgba(76, 175, 80, 0.6)' : 'rgba(76, 175, 80, 0.5)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const midT = 23, midR = this.calc.calcR(50, 23) * 1000;
    ctx.fillText('Zone de confort', this.toCanvasX(midT), this.toCanvasY(midR));
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = this.gridAlpha;
    for (let T = Math.ceil(this.Xmin / 5) * 5; T <= this.Xmax; T += 5) {
      ctx.beginPath();
      ctx.moveTo(this.toCanvasX(T), this.toCanvasY(this.Ymin));
      ctx.lineTo(this.toCanvasX(T), this.toCanvasY(this.Ymax));
      ctx.stroke();
    }
    for (let R = 0; R <= this.Ymax; R += 5) {
      ctx.beginPath();
      ctx.moveTo(this.toCanvasX(this.Xmin), this.toCanvasY(R));
      ctx.lineTo(this.toCanvasX(this.Xmax), this.toCanvasY(R));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawHRCurves() {
    const ctx = this.ctx;
    const hrLevels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (const hr of hrLevels) {
      const isSat = hr === 100;
      ctx.strokeStyle = isSat ? this.colors.saturation : this.colors.hr_lines;
      ctx.lineWidth = isSat ? 2.5 : 1;
      ctx.globalAlpha = isSat ? 1 : 0.6;
      ctx.beginPath();
      let started = false;
      for (let T = this.Xmin; T <= this.Xmax; T += 0.5) {
        const R = this.calc.calcR(hr, T) * 1000;
        if (R > this.Ymax || R < this.Ymin) continue;
        const x = this.toCanvasX(T);
        const y = this.toCanvasY(R);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (hr < 100) {
        const labelT = this.Xmax - 5 - (100 - hr) * 0.3;
        const labelR = this.calc.calcR(hr, labelT) * 1000;
        if (labelR > this.Ymin && labelR < this.Ymax) {
          ctx.fillStyle = this.colors.hr_lines;
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'left';
          ctx.globalAlpha = 0.7;
          ctx.fillText(hr + '%', this.toCanvasX(labelT) + 2, this.toCanvasY(labelR) - 3);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  drawEnthalpyLines() {
    const ctx = this.ctx;
    const Rsat = this.calc.calcR(100, this.Xmax);
    const hMin = Math.round(this.calc.calcEnthalpie(this.Xmin, this.Ymin / 1000));
    const hMax = Math.round(this.calc.calcEnthalpie(this.Xmax, this.Ymax / 1000));
    ctx.strokeStyle = this.colors.enthalpy_lines;
    ctx.lineWidth = 0.5;
    for (let h = hMin; h <= hMax; h += 10) {
      const T1 = this.calc.calcTsecDepuisEnthalpie(h, Rsat);
      const R1 = Rsat * 1000;
      const T2 = this.calc.calcTsecDepuisEnthalpie(h, 0);
      const R2 = 0;
      let x1 = T1, y1 = R1, x2 = T2, y2 = R2;
      if (y1 > this.Ymax) { const r = (this.Ymax - y2) / (y1 - y2); x1 = x2 + (x1 - x2) * r; y1 = this.Ymax; }
      if (x1 < this.Xmin) { const r = (this.Xmin - x2) / (x1 - x2); y1 = y2 + (y1 - y2) * r; x1 = this.Xmin; }
      if (x2 > this.Xmax) { const r = (this.Xmax - x1) / (x2 - x1); y2 = y1 + (y2 - y1) * r; x2 = this.Xmax; }
      if (x1 >= this.Xmin && x2 <= this.Xmax && y1 <= this.Ymax && y2 >= this.Ymin) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(this.toCanvasX(x1), this.toCanvasY(y1));
        ctx.lineTo(this.toCanvasX(x2), this.toCanvasY(y2));
        ctx.stroke();
        // Label enthalpie on the line (at the top/left end)
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = this.colors.enthalpy_lines;
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        const lx = this.toCanvasX(x1);
        const ly = this.toCanvasY(y1);
        if (ly > this.margin.top + 10 && lx > this.margin.left + 10) {
          ctx.fillText(h + '', lx - 8, ly - 3);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawAxes() {
    const ctx = this.ctx;
    ctx.strokeStyle = this.colors.text;
    ctx.fillStyle = this.colors.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.toCanvasX(this.Xmin), this.toCanvasY(this.Ymin));
    ctx.lineTo(this.toCanvasX(this.Xmax), this.toCanvasY(this.Ymin));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.toCanvasX(this.Xmax), this.toCanvasY(this.Ymin));
    ctx.lineTo(this.toCanvasX(this.Xmax), this.toCanvasY(this.Ymax));
    ctx.stroke();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (let T = Math.ceil(this.Xmin / 5) * 5; T <= this.Xmax; T += 5) {
      ctx.fillText(T + '\u00b0', this.toCanvasX(T), this.toCanvasY(this.Ymin) + 13);
    }
    ctx.textAlign = 'left';
    for (let R = 0; R <= this.Ymax; R += 5) {
      ctx.fillText(R, this.toCanvasX(this.Xmax) + 5, this.toCanvasY(R) + 4);
    }
    // Axis labels aligned with axes
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('T (\u00b0C)', this.toCanvasX(this.Xmin), this.toCanvasY(this.Ymin) + 13);
    ctx.textAlign = 'left';
    ctx.fillText('H', this.toCanvasX(this.Xmax) + 5, this.toCanvasY(this.Ymax) - 5);
  }

  drawPoints(points) {
    if (!points || !points.length) return;
    const ctx = this.ctx;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p.visible) continue;
      if (p.temperature === null || p.humidity === null) continue;
      if (isNaN(p.temperature) || isNaN(p.humidity)) continue;
      const T = p.temperature;
      const HR = p.humidity;
      const R = this.calc.calcR(HR, T) * 1000;
      if (T < this.Xmin || T > this.Xmax || R < this.Ymin || R > this.Ymax) continue;
      const x = this.toCanvasX(T);
      const y = this.toCanvasY(R);
      const color = p.color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = this.colors.point_stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

// ===== Home Assistant Custom Card =====
class PsychrometricCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized = false;
    this._visibility = {};
    this._legendBuilt = false;
    this._lastValues = '';
    this._selectedIdx = null;
    this._selectedIdx2 = null;
  }

  set hass(hass) {
    this._hass = hass;
    // Once only, and before the first render: the legend is built from this list, and a
    // list that grew under the user would renumber the visibility they saved.
    if (this._config.auto_discover && !this._discovered) {
      this._discovered = true;
      const found = this._discoverSensors();
      const known = this._config.sensors.map((s) => s.temperature);
      const added = found.filter((s) => known.indexOf(s.temperature) === -1);
      this._config.sensors = this._config.sensors.concat(added);
      this._resetVisibility();
      this._publishSensorList(added.length, found.length);
    }
    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }
    this._updateData();
  }

  setConfig(config) {
    if ((!config.sensors || !config.sensors.length) && !config.auto_discover) {
      throw new Error('Define at least one sensor pair, or set auto_discover: true');
    }
    this._config = {
      dark_mode: config.dark_mode !== undefined ? config.dark_mode : true,
      background: config.background,
      temp_min: config.temp_min !== undefined ? config.temp_min : -5,
      temp_max: config.temp_max !== undefined ? config.temp_max : 45,
      humidity_max: config.humidity_max !== undefined ? config.humidity_max : 25,
      sensors: config.sensors ? config.sensors.slice() : [],
      auto_discover: this._discoveryOptions(config.auto_discover),
      height: config.height || 450,
    };
    this._discovered = false;
    this._resetVisibility();
  }

  _resetVisibility() {
    this._visibility = {};
    this._config.sensors.forEach((_, idx) => { this._visibility[idx] = true; });
    this._loadVisibility();
  }

  // `auto_discover: true` or a map of filters. Everything is lowercased once here so
  // the matching below never has to think about case again.
  _discoveryOptions(cfg) {
    if (!cfg) return null;
    const c = cfg === true ? {} : cfg;
    const list = (v) => (v === undefined || v === null)
      ? null
      : (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase());
    return {
      areas: list(c.area !== undefined ? c.area : c.areas),
      exclude: list(c.exclude) || [],
    };
  }

  // Pairs temperature and humidity sensors without a hand-written list, in two passes.
  // Same device first -- unambiguous, it is the manufacturer saying these two readings
  // come from one probe. Then same signature, and only when exactly one candidate
  // matches: a house with two nameless candidates gets no pair rather than a wrong one.
  _discoverSensors() {
    const hass = this._hass;
    const opts = this._config.auto_discover;
    if (!hass || !opts) return [];
    const reg = hass.entities || {};
    const devices = hass.devices || {};
    const areas = hass.areas || {};

    const areaOf = (id) => {
      const e = reg[id];
      if (e && e.area_id) return e.area_id;
      const d = e && e.device_id;
      return (d && devices[d] && devices[d].area_id) || null;
    };
    const areaName = (aid) => (aid && areas[aid] && areas[aid].name) || aid || '';
    const keep = (id) => {
      const e = reg[id];
      // entity_category covers the diagnostic readings a device exposes about itself
      // (CPU probes, battery temperature): never a room.
      if (e && (e.disabled_by || e.hidden || e.entity_category)) return false;
      if (e && DERIVED_PLATFORMS.test(e.platform || '')) return false;
      if (opts.exclude.some((x) => id.toLowerCase().indexOf(x) !== -1)) return false;
      if (opts.areas) {
        const aid = areaOf(id);
        if (opts.areas.indexOf(String(aid).toLowerCase()) === -1 &&
            opts.areas.indexOf(areaName(aid).toLowerCase()) === -1) return false;
      }
      return true;
    };
    const byClass = (dc) => Object.keys(hass.states).filter((id) =>
      id.indexOf('sensor.') === 0 &&
      hass.states[id].attributes.device_class === dc &&
      keep(id));

    const temps = byClass('temperature');
    const hums = byClass('humidity');
    const devOf = (id) => reg[id] && reg[id].device_id;
    const signature = (id) => id.slice(id.indexOf('.') + 1).split('_')
      .filter((w) => !QUANTITY_WORDS.test(w)).sort().join('_');

    const taken = {};
    const pairs = [];
    for (const t of temps) {
      const d = devOf(t);
      if (!d) continue;
      const h = hums.find((x) => devOf(x) === d && !taken[x]);
      if (h) { taken[h] = true; pairs.push([t, h]); }
    }
    for (const t of temps) {
      if (pairs.some((p) => p[0] === t)) continue;
      const sig = signature(t);
      if (!sig) continue;
      const cands = hums.filter((x) => !taken[x] && signature(x) === sig);
      if (cands.length === 1) { taken[cands[0]] = true; pairs.push([t, cands[0]]); }
    }

    // A legend cell is narrow, and some integrations name their device after a whole
    // sentence -- Meteo-France ships "Meteo-France forecast for city <town> - <region>
    // (13) - FR". So each candidate has to earn its place by fitting; the entity_id,
    // which is always short, is the one that never fails.
    const strip = (v) => {
      let out = String(v || '').trim();
      let prev = null;
      // Repeated because one pass leaves "Thermometre Temperature Salon" half-cleaned.
      while (out !== prev) { prev = out; out = out.replace(LABEL_NOISE, '').trim(); }
      return out;
    };
    const label = (t) => {
      const fn = strip(hass.states[t].attributes.friendly_name);
      if (fn && fn.length <= MAX_LABEL) return fn;
      const d = devOf(t);
      const dev = d && devices[d];
      const dn = dev ? strip(dev.name_by_user || dev.name) : '';
      if (dn && dn.length <= MAX_LABEL) return dn;
      const words = t.slice(t.indexOf('.') + 1).split('_').filter((w) => !QUANTITY_WORDS.test(w));
      const plain = words.join(' ');
      return plain.charAt(0).toUpperCase() + plain.slice(1);
    };
    return pairs
      .map(([t, h]) => ({ name: label(t), temperature: t, humidity: h }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // The resolved list is worth having outside the card: it is what to paste under
  // `sensors:` to freeze the pairing, and what to check when a pair looks wrong.
  _publishSensorList(added, found) {
    const yaml = 'sensors:\n' + this._config.sensors.map((s) =>
      '  - name: "' + s.name + '"\n' +
      '    temperature: ' + s.temperature + '\n' +
      '    humidity: ' + s.humidity).join('\n');
    try { window.__psychrometricCardSensors = yaml; } catch (e) { /* sandboxed */ }
    console.info('[psychrometric-card] auto_discover: ' + found + ' pair(s) found, ' +
      added + ' added to ' + (this._config.sensors.length - added) + ' declared. ' +
      'Full list in window.__psychrometricCardSensors:\n' + yaml);
  }

  _getStorageKey() {
    return 'psychro-card-visibility-v3';
  }

  // v2 stored visibility by position in the list, which stops meaning anything the moment
  // the list changes order or length -- and auto_discover changes both, so hiding the
  // freezer could come back as hiding a bedroom. It is keyed by the temperature entity
  // now: a sensor keeps its state wherever it lands, and two cards sharing this key no
  // longer overwrite each other just for having a sensor at the same index.
  _loadVisibility() {
    try {
      const raw = localStorage.getItem(this._getStorageKey());
      if (raw) {
        const saved = JSON.parse(raw);
        this._config.sensors.forEach((sensor, idx) => {
          if (saved[sensor.temperature] !== undefined) {
            this._visibility[idx] = saved[sensor.temperature] !== false;
          }
        });
        return;
      }
      this._migrateVisibility();
    } catch (e) { /* no storage, or corrupt: everything stays visible */ }
  }

  // One-off carry-over from v2, so nobody loses what they had hidden. The old key is left
  // in place rather than cleaned up: another card on this origin may not have migrated yet,
  // and it is never written again.
  _migrateVisibility() {
    const raw = localStorage.getItem('psychro-card-visibility-v2');
    if (!raw) return;
    const saved = JSON.parse(raw);
    this._config.sensors.forEach((_, idx) => {
      if (saved[idx] !== undefined) this._visibility[idx] = saved[idx] !== false;
    });
    this._saveVisibility();
  }

  // Open unless it was closed on purpose: a first visit should show what the card holds.
  _loadPanelOpen() {
    try {
      return localStorage.getItem(PANEL_STORAGE_KEY) !== 'closed';
    } catch (e) {
      return true;
    }
  }

  _saveVisibility() {
    try {
      const raw = localStorage.getItem(this._getStorageKey());
      // Merge rather than replace: a sensor this card does not show may be recorded by
      // another one, and dropping it would silently un-hide it there.
      const out = raw ? JSON.parse(raw) : {};
      this._config.sensors.forEach((sensor, idx) => {
        out[sensor.temperature] = this._visibility[idx] !== false;
      });
      localStorage.setItem(this._getStorageKey(), JSON.stringify(out));
    } catch (e) { /* ignore */ }
  }

  _initialize() {
    const height = this._config.height;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          min-width: 0;
        }
        ha-card {
          padding: 8px;
          overflow: hidden;
          box-sizing: border-box;
          height: 100%;
          width: 100%;
        }
        canvas {
          display: block;
          width: 100%;
          border-radius: 8px;
          cursor: crosshair;
        }
        .panel {
          margin-top: 8px;
        }
        .panel > summary {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.08);
          font-size: 12px;
          color: var(--primary-text-color, #ccc);
          cursor: pointer;
          user-select: none;
          -webkit-user-select: none;
          list-style: none;
        }
        /* Both are needed: the pseudo-element is WebKit's, list-style is everyone else's. */
        .panel > summary::-webkit-details-marker {
          display: none;
        }
        .panel > summary:hover {
          background: rgba(255,255,255,0.08);
        }
        .chevron {
          width: 0;
          height: 0;
          flex-shrink: 0;
          border-left: 5px solid currentColor;
          border-top: 4px solid transparent;
          border-bottom: 4px solid transparent;
          transition: transform 0.15s;
        }
        .panel[open] > summary .chevron {
          transform: rotate(90deg);
        }
        .panel-title {
          font-weight: 500;
        }
        .panel-count {
          margin-left: auto;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        }
        .toolbar {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 8px 0 6px 0;
          padding: 0;
          flex-wrap: wrap;
        }
        .toolbar button {
          background: rgba(255,255,255,0.08);
          color: var(--primary-text-color, #aaa);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .toolbar button:hover {
          background: rgba(255,255,255,0.15);
        }
        .toolbar button:active {
          background: rgba(255,255,255,0.25);
        }
        .legend {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 3px;
          padding: 0;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--primary-text-color, #ccc);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.08);
          transition: all 0.15s;
          user-select: none;
          -webkit-user-select: none;
          overflow: hidden;
        }
        .legend-item:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.2);
        }
        .legend-item:active {
          transform: scale(0.97);
        }
        .legend-item[data-visible="false"] {
          opacity: 0.25;
          border-color: transparent;
        }
        .legend-item[data-visible="false"] .dot {
          background: #555 !important;
        }
        .legend-item[data-selected="true"] {
          border-color: var(--legend-sel-color, rgba(255,255,255,0.5));
          background: rgba(255,255,255,0.06);
          box-shadow: 0 0 0 1px var(--legend-sel-color, rgba(255,255,255,0.3));
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .legend-name {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
        }
        .legend-val {
          font-variant-numeric: tabular-nums;
          opacity: 0.6;
          font-size: 10px;
          white-space: nowrap;
          margin-left: auto;
        }
      </style>
      <ha-card>
        <canvas id="psychro-canvas"></canvas>
        <details class="panel" id="panel">
          <summary>
            <span class="chevron"></span>
            <span class="panel-title">Capteurs</span>
            <span class="panel-count" id="panel-count"></span>
          </summary>
          <div class="toolbar">
            <button id="btn-all">Tout afficher</button>
            <button id="btn-none">Tout masquer</button>
          </div>
          <div class="legend" id="legend"></div>
        </details>
      </ha-card>
    `;

    this._canvas = this.shadowRoot.getElementById('psychro-canvas');
    this._legendEl = this.shadowRoot.getElementById('legend');

    // Toolbar handlers
    this.shadowRoot.getElementById('btn-all').addEventListener('click', () => {
      this._config.sensors.forEach((_, i) => { this._visibility[i] = true; });
      this._saveVisibility();
      this._applyVisibility();
    });
    this.shadowRoot.getElementById('btn-none').addEventListener('click', () => {
      this._config.sensors.forEach((_, i) => { this._visibility[i] = false; });
      this._saveVisibility();
      this._applyVisibility();
    });

    // Folded or not is remembered, so a card left closed opens closed. The chart is the
    // point of this card; the list underneath is there when it is wanted.
    this._panelEl = this.shadowRoot.getElementById('panel');
    this._panelCountEl = this.shadowRoot.getElementById('panel-count');
    this._panelEl.open = this._loadPanelOpen();
    this._panelEl.addEventListener('toggle', () => {
      try {
        localStorage.setItem(PANEL_STORAGE_KEY, this._panelEl.open ? 'open' : 'closed');
      } catch (e) { /* no storage: it just will not be remembered */ }
    });

    // Build legend DOM ONCE (event delegation for clicks)
    this._legendEl.addEventListener('click', (e) => {
      const item = e.target.closest('.legend-item');
      if (!item) return;
      const idx = parseInt(item.dataset.idx);
      if (isNaN(idx)) return;
      this._visibility[idx] = !this._visibility[idx];
      this._saveVisibility();
      this._applyVisibility();
      // Hide detail if the selected point was just hidden
      if (this._selectedIdx === idx && !this._visibility[idx]) {
        this._hideDetail();
      }
    });

    // Build legend items once
    this._config.sensors.forEach((sensor, idx) => {
      const color = sensor.color || POINT_COLORS[idx % POINT_COLORS.length];
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.dataset.idx = idx;
      item.dataset.visible = this._visibility[idx] !== false ? 'true' : 'false';
      item.innerHTML = `
        <div class="dot" style="background:${color}"></div>
        <span class="legend-name">${sensor.name || sensor.temperature.split('.')[1]}</span>
        <span class="legend-val" id="val-${idx}">--</span>
      `;
      this._legendEl.appendChild(item);
    });
    this._legendBuilt = true;
    // Puts the count on the summary line straight away: folded, it is the only sign that
    // anything is hidden.
    this._applyVisibility();

    // Click on canvas to select nearest point (supports 2-point comparison)
    this._canvas.addEventListener('click', (e) => {
      if (!this._points || !this._chart) return;
      const rect = this._canvas.getBoundingClientRect();
      const scaleX = this._chart.logicalWidth / rect.width;
      const scaleY = this._chart.logicalHeight / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      let bestIdx = -1;
      let bestDist = Infinity;
      const hitRadius = 20; // logical pixels

      for (let i = 0; i < this._points.length; i++) {
        const p = this._points[i];
        if (!p.visible || p.temperature === null || p.humidity === null) continue;
        const R = this.calc.calcR(p.humidity, p.temperature) * 1000;
        const px = this._chart.toCanvasX(p.temperature);
        const py = this._chart.toCanvasY(R);
        const dist = Math.hypot(cx - px, cy - py);
        if (dist < hitRadius && dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        // Clicked on a point
        if (this._selectedIdx === bestIdx) {
          // Deselect first point
          this._hideDetail();
        } else if (this._selectedIdx2 === bestIdx) {
          // Deselect second point → back to single
          this._selectedIdx2 = null;
          this._drawChart();
        } else if (this._selectedIdx === null) {
          // No selection → select first
          this._showDetail(bestIdx);
        } else if (this._selectedIdx2 === null) {
          // Already one selected → select second for comparison
          this._selectedIdx2 = bestIdx;
          this._drawChart();
        } else {
          // Both slots full → replace second
          this._selectedIdx2 = bestIdx;
          this._drawChart();
        }
      } else {
        // Clicked empty space → clear all
        this._hideDetail();
      }
    });

    // Canvas setup - responsive to container width
    this._aspectRatio = 900 / height; // width/height ratio
    this._chart = new PsychroChart(this._canvas, this._config);
    this.calc = new PsychroCalc();
    this._points = [];

    // Defer initial sizing to after layout is complete
    const doInitialSize = () => {
      const container = this.shadowRoot.querySelector('ha-card');
      const cw = Math.max((container ? container.clientWidth - 16 : 900), 280);
      if (cw <= 280 && container && container.clientWidth === 0) {
        // Not laid out yet, retry
        requestAnimationFrame(doInitialSize);
        return;
      }
      this._chart.logicalWidth = cw;
      this._chart.logicalHeight = Math.round(cw / this._aspectRatio);
      this._resizeCanvas();
      this._drawChart();
    };
    requestAnimationFrame(doInitialSize);

    // Redraw on container resize (debounced)
    this._resizeTimeout = null;
    this._resizeObserver = new ResizeObserver(() => {
      if (this._resizeTimeout) cancelAnimationFrame(this._resizeTimeout);
      this._resizeTimeout = requestAnimationFrame(() => {
        this._resizeCanvas();
        if (this._chart) {
          this._chart.canvas = this._canvas;
          this._drawChart();
        }
      });
    });
    this._resizeObserver.observe(this.shadowRoot.querySelector('ha-card'));
  }

  // Called on every hass update - only updates values, never rebuilds DOM
  _updateData() {
    if (!this._hass || !this._config || !this._legendBuilt) return;

    let valuesHash = '';

    this._points = this._config.sensors.map((sensor, idx) => {
      const tempState = this._hass.states[sensor.temperature];
      const humState = this._hass.states[sensor.humidity];
      const temp = tempState ? parseFloat(tempState.state) : null;
      const hum = humState ? parseFloat(humState.state) : null;
      const validTemp = (temp !== null && !isNaN(temp)) ? temp : null;
      const validHum = (hum !== null && !isNaN(hum)) ? hum : null;

      // Update legend value text (no DOM rebuild)
      const valEl = this.shadowRoot.getElementById(`val-${idx}`);
      if (valEl) {
        const txt = (validTemp !== null && validHum !== null)
          ? `${validTemp.toFixed(1)}\u00b0C / ${validHum.toFixed(0)}%`
          : 'N/A';
        if (valEl.textContent !== txt) valEl.textContent = txt;
      }

      valuesHash += `${validTemp},${validHum},`;

      return {
        name: sensor.name || sensor.temperature.split('.')[1],
        temperature: validTemp,
        humidity: validHum,
        color: sensor.color || POINT_COLORS[idx % POINT_COLORS.length],
        visible: this._visibility[idx] !== false,
      };
    });

    // Only redraw canvas if values actually changed
    if (valuesHash !== this._lastValues) {
      this._lastValues = valuesHash;
      this._drawChart();
      // Update detail panel if open
      if (this._selectedIdx !== null && this._selectedIdx !== undefined) {
        this._showDetail(this._selectedIdx);
      }
    }
  }

  // Apply visibility changes (called from UI interactions only)
  _applyVisibility() {
    // Update DOM attributes
    this._config.sensors.forEach((_, idx) => {
      const item = this._legendEl.querySelector(`[data-idx="${idx}"]`);
      if (item) {
        item.dataset.visible = this._visibility[idx] ? 'true' : 'false';
      }
    });
    // Worth saying on the summary line: folded, it is the only clue that something is
    // hidden, and an empty chart otherwise looks broken.
    if (this._panelCountEl) {
      const total = this._config.sensors.length;
      const shown = this._config.sensors.filter((_, i) => this._visibility[i] !== false).length;
      this._panelCountEl.textContent = shown === total ? String(total) : shown + ' / ' + total;
    }
    // Update points visibility
    if (this._points) {
      this._points.forEach((p, idx) => {
        p.visible = this._visibility[idx] !== false;
      });
    }
    this._drawChart();
  }

  _resizeCanvas() {
    const container = this.shadowRoot.querySelector('ha-card');
    if (!container || !this._canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(container.clientWidth - 16, 280); // 8px padding each side
    const h = Math.round(w / this._aspectRatio);
    this._canvas.width = w * dpr;
    this._canvas.height = h * dpr;
    this._canvas.style.width = '100%';
    this._canvas.style.height = h + 'px';
    this._canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    // Update chart logical dimensions
    if (this._chart) {
      this._chart.logicalWidth = w;
      this._chart.logicalHeight = h;
    }
  }

  _drawChart() {
    if (!this._chart || !this._canvas) return;
    this._resizeCanvas();
    this._chart.canvas = this._canvas;
    this._chart.draw(this._points);
    // Draw overlay: comparison if 2 selected, detail if 1
    if (this._selectedIdx !== null && this._selectedIdx !== undefined) {
      if (this._selectedIdx2 !== null && this._selectedIdx2 !== undefined) {
        this._drawCompareOnCanvas(this._selectedIdx, this._selectedIdx2);
      } else {
        this._drawDetailOnCanvas(this._selectedIdx);
      }
    }
    this._updateLegendSelection();
  }

  _updateLegendSelection() {
    if (!this._legendEl) return;
    const items = this._legendEl.querySelectorAll('.legend-item');
    items.forEach(item => {
      const idx = parseInt(item.dataset.idx);
      const isSel = (idx === this._selectedIdx || idx === this._selectedIdx2);
      item.dataset.selected = isSel ? 'true' : 'false';
      if (isSel) {
        const color = this._points && this._points[idx] ? this._points[idx].color : '';
        item.style.setProperty('--legend-sel-color', color);
      } else {
        item.style.removeProperty('--legend-sel-color');
      }
    });
  }

  _drawDetailOnCanvas(idx) {
    if (!this._points || !this._points[idx]) return;
    const p = this._points[idx];
    if (p.temperature === null || p.humidity === null) return;

    const T = p.temperature;
    const HR = p.humidity;
    const R = this.calc.calcR(HR, T) * 1000;
    const Tr = this.calc.calcTr(HR, T);
    const h = this.calc.calcEnthalpie(T, R / 1000);

    const ctx = this._canvas.getContext('2d');
    const w = this._chart.logicalWidth;
    const margin = this._chart.margin;

    // Table dimensions
    const tableW = 170;
    const lineH = 18;
    const rows = [
      ['Temperature', T.toFixed(1) + ' \u00b0C'],
      ['HR', HR.toFixed(1) + ' %'],
      ['Abs', R.toFixed(2) + ' g/kg'],
      ['Pt rosee', (Tr !== null ? Tr.toFixed(1) : '--') + ' \u00b0C'],
      ['Enthalpie', h.toFixed(1) + ' kJ/kg'],
    ];
    const tableH = lineH * rows.length + 30; // +30 for title
    const tableX = margin.left + 10;
    const tableY = margin.top + 10;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(tableX, tableY, tableW, tableH, 8);
    ctx.fill();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(tableX, tableY, tableW, tableH, 8);
    ctx.stroke();

    // Title
    ctx.fillStyle = p.color;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('\u25cf ' + p.name, tableX + 10, tableY + 18);

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(tableX + 8, tableY + 26);
    ctx.lineTo(tableX + tableW - 8, tableY + 26);
    ctx.stroke();

    // Rows
    ctx.font = '11px sans-serif';
    rows.forEach((row, i) => {
      const y = tableY + 30 + i * lineH + 12;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'left';
      ctx.fillText(row[0], tableX + 10, y);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(row[1], tableX + tableW - 10, y);
      ctx.font = '11px sans-serif';
    });
  }

  _drawCompareOnCanvas(idxA, idxB) {
    if (!this._points || !this._points[idxA] || !this._points[idxB]) return;
    const pA = this._points[idxA];
    const pB = this._points[idxB];
    if (pA.temperature === null || pA.humidity === null) return;
    if (pB.temperature === null || pB.humidity === null) return;

    const TA = pA.temperature, HRA = pA.humidity;
    const TB = pB.temperature, HRB = pB.humidity;
    const RA = this.calc.calcR(HRA, TA) * 1000;
    const RB = this.calc.calcR(HRB, TB) * 1000;
    const TrA = this.calc.calcTr(HRA, TA);
    const TrB = this.calc.calcTr(HRB, TB);
    const hA = this.calc.calcEnthalpie(TA, RA / 1000);
    const hB = this.calc.calcEnthalpie(TB, RB / 1000);

    const ctx = this._canvas.getContext('2d');
    const margin = this._chart.margin;

    // Draw line between points
    const xA = this._chart.toCanvasX(TA);
    const yA = this._chart.toCanvasY(RA);
    const xB = this._chart.toCanvasX(TB);
    const yB = this._chart.toCanvasY(RB);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xA, yA);
    ctx.lineTo(xB, yB);
    ctx.stroke();
    ctx.restore();

    // Table layout
    const tableW = 280;
    const lineH = 18;
    const colLabel = 70;
    const colA = 75;
    const colB = 75;
    const colDelta = 60;
    const headerH = 26;
    const rows = [
      ['Temp.', TA.toFixed(1) + '\u00b0C', TB.toFixed(1) + '\u00b0C', (TB - TA).toFixed(1) + '\u00b0C'],
      ['HR', HRA.toFixed(1) + '%', HRB.toFixed(1) + '%', (HRB - HRA).toFixed(1) + '%'],
      ['Abs.', RA.toFixed(2) + ' g/kg', RB.toFixed(2) + ' g/kg', (RB - RA).toFixed(2)],
      ['Rosee', (TrA !== null ? TrA.toFixed(1) : '--') + '\u00b0C', (TrB !== null ? TrB.toFixed(1) : '--') + '\u00b0C',
        (TrA !== null && TrB !== null ? (TrB - TrA).toFixed(1) : '--') + '\u00b0C'],
      ['Enthalpie', hA.toFixed(1) + ' kJ/kg', hB.toFixed(1) + ' kJ/kg', (hB - hA).toFixed(1)],
    ];
    const tableH = headerH + lineH * rows.length + 10;
    const tableX = margin.left + 10;
    const tableY = margin.top + 10;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.roundRect(tableX, tableY, tableW, tableH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tableX, tableY, tableW, tableH, 8);
    ctx.stroke();

    // Header row: point names
    const hdrY = tableY + 18;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('', tableX + 10, hdrY);
    ctx.fillStyle = pA.color;
    ctx.textAlign = 'center';
    ctx.fillText('\u25cf ' + pA.name, tableX + colLabel + colA / 2, hdrY);
    ctx.fillStyle = pB.color;
    ctx.fillText('\u25cf ' + pB.name, tableX + colLabel + colA + colB / 2, hdrY);
    ctx.fillStyle = '#ffc107';
    ctx.fillText('\u0394', tableX + colLabel + colA + colB + colDelta / 2, hdrY);

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(tableX + 8, tableY + headerH);
    ctx.lineTo(tableX + tableW - 8, tableY + headerH);
    ctx.stroke();

    // Data rows
    ctx.font = '11px sans-serif';
    rows.forEach((row, i) => {
      const y = tableY + headerH + i * lineH + 14;
      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'left';
      ctx.fillText(row[0], tableX + 10, y);
      // Value A
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(row[1], tableX + colLabel + colA / 2, y);
      // Value B
      ctx.fillText(row[2], tableX + colLabel + colA + colB / 2, y);
      // Delta
      ctx.fillStyle = '#ffc107';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(row[3], tableX + colLabel + colA + colB + colDelta / 2, y);
      ctx.font = '11px sans-serif';
    });
  }

  _showDetail(idx) {
    if (!this._points || !this._points[idx]) return;
    const p = this._points[idx];
    if (p.temperature === null || p.humidity === null) return;
    this._selectedIdx = idx;
    this._drawChart();
  }

  _hideDetail() {
    this._selectedIdx = null;
    this._selectedIdx2 = null;
    this._drawChart();
  }

  getCardSize() { return 6; }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  static getStubConfig() {
    return {
      sensors: [
        { name: "Salon", temperature: "sensor.salon_1_temperature", humidity: "sensor.salon_1_humidity" }
      ]
    };
  }
}

customElements.define('psychrometric-card', PsychrometricCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'psychrometric-card',
  name: 'Psychrometric Chart',
  description: 'Psychrometric diagram with interactive temperature/humidity sensor points',
});
