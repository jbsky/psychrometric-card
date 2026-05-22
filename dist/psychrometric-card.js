/**
 * Psychrometric Chart Card for Home Assistant
 * Based on https://github.com/jbsky/Psychrometrique
 * Renders a psychrometric diagram with live HA sensor data points
 * Interactive legend: click to enable/disable individual points
 */

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

    this.colors = {
      background: config.dark_mode ? '#1c1c1e' : '#ffffff',
      grid: config.dark_mode ? '#333333' : '#e0e0e0',
      text: config.dark_mode ? '#cccccc' : '#333333',
      saturation: config.dark_mode ? '#ff6b6b' : '#d32f2f',
      hr_lines: config.dark_mode ? '#ff8a80' : '#e57373',
      enthalpy_lines: config.dark_mode ? '#ffab40' : '#f57c00',
      comfort_zone: config.dark_mode ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.1)',
    };

    this.margin = { top: 20, right: 50, bottom: 40, left: 50 };
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

  draw(points) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);

    this.drawComfortZone();
    this.drawGrid();
    this.drawHRCurves();
    this.drawEnthalpyLines();
    this.drawAxes();
    this.drawPoints(points);
    this.drawTitle();
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

    ctx.fillStyle = this.colors.dark_mode ? 'rgba(76, 175, 80, 0.6)' : 'rgba(76, 175, 80, 0.5)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const midT = 23, midR = this.calc.calcR(50, 23) * 1000;
    ctx.fillText('Zone de confort', this.toCanvasX(midT), this.toCanvasY(midR));
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 0.5;
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
      ctx.fillText(T + '\u00b0C', this.toCanvasX(T), this.toCanvasY(this.Ymin) + 15);
    }
    ctx.textAlign = 'left';
    for (let R = 0; R <= this.Ymax; R += 5) {
      ctx.fillText(R + ' g/kg', this.toCanvasX(this.Xmax) + 5, this.toCanvasY(R) + 4);
    }
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Temperature seche (\u00b0C)', this.toCanvasX((this.Xmin + this.Xmax) / 2), this.logicalHeight - 5);
    ctx.save();
    ctx.translate(this.logicalWidth - 10, this.toCanvasY((this.Ymin + this.Ymax) / 2));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Humidite absolue (g/kg air sec)', 0, 0);
    ctx.restore();
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
      ctx.strokeStyle = this.colors.background;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${p.name} (${T.toFixed(1)}\u00b0C, ${HR.toFixed(0)}%)`, x + 9, y + 4);
    }
  }

  drawTitle() {
    const ctx = this.ctx;
    ctx.fillStyle = this.colors.text;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Diagramme Psychrometrique', this.margin.left, 15);
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
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialize();
      this._initialized = true;
    }
    this._updateData();
  }

  setConfig(config) {
    if (!config.sensors || !config.sensors.length) {
      throw new Error('You need to define at least one sensor pair');
    }
    this._config = {
      title: config.title || 'Diagramme Psychrometrique',
      dark_mode: config.dark_mode !== undefined ? config.dark_mode : true,
      temp_min: config.temp_min !== undefined ? config.temp_min : -5,
      temp_max: config.temp_max !== undefined ? config.temp_max : 45,
      humidity_max: config.humidity_max !== undefined ? config.humidity_max : 25,
      sensors: config.sensors,
      height: config.height || 450,
    };
    this._visibility = {};
    this._config.sensors.forEach((_, idx) => { this._visibility[idx] = true; });
    this._loadVisibility();
  }

  _getStorageKey() {
    return 'psychro-card-visibility-v2';
  }

  _loadVisibility() {
    try {
      const saved = localStorage.getItem(this._getStorageKey());
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(key => {
          const idx = parseInt(key);
          if (idx < this._config.sensors.length) {
            this._visibility[idx] = parsed[key];
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  _saveVisibility() {
    try {
      localStorage.setItem(this._getStorageKey(), JSON.stringify(this._visibility));
    } catch (e) { /* ignore */ }
  }

  _initialize() {
    const height = this._config.height;
    const pointColors = [
      '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
      '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
      '#8bc34a', '#cddc39', '#ffc107', '#ff9800', '#ff5722',
      '#795548', '#607d8b'
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          padding: 16px;
          overflow: hidden;
          box-sizing: border-box;
        }
        canvas {
          display: block;
          width: 100%;
          border-radius: 8px;
        }
        .toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 12px 0 10px 0;
          padding: 0;
        }
        .toolbar button {
          background: rgba(255,255,255,0.1);
          color: var(--primary-text-color, #ccc);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .toolbar button:hover {
          background: rgba(255,255,255,0.2);
        }
        .toolbar button:active {
          background: rgba(255,255,255,0.3);
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 8px;
          padding: 0;
        }
        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--primary-text-color, #ccc);
          cursor: pointer;
          padding: 5px 10px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          transition: all 0.2s;
          user-select: none;
          -webkit-user-select: none;
        }
        .legend-item:hover {
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.25);
        }
        .legend-item:active {
          transform: scale(0.95);
        }
        .legend-item[data-visible="false"] {
          opacity: 0.3;
          border-color: rgba(255,255,255,0.05);
        }
        .legend-item[data-visible="false"] .dot {
          background: #555 !important;
        }
        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .legend-name {
          font-weight: 500;
        }
        .legend-val {
          font-variant-numeric: tabular-nums;
          opacity: 0.7;
          font-size: 11px;
        }
        .detail-panel {
          margin-top: 12px;
          padding: 12px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          display: none;
        }
        .detail-panel.active {
          display: block;
        }
        .detail-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color, #eee);
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .detail-title .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .detail-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }
        .detail-table td {
          padding: 4px 8px;
          color: var(--primary-text-color, #ccc);
        }
        .detail-table td:first-child {
          opacity: 0.6;
          white-space: nowrap;
        }
        .detail-table td:last-child {
          font-weight: 600;
          text-align: right;
        }
      </style>
      <ha-card>
        <canvas id="psychro-canvas"></canvas>
        <div class="toolbar">
          <button id="btn-all">Tout afficher</button>
          <button id="btn-none">Tout masquer</button>
          <button id="btn-indoor">Interieur</button>
          <button id="btn-outdoor">Exterieur</button>
        </div>
        <div class="legend" id="legend"></div>
        <div class="detail-panel" id="detail-panel">
          <div class="detail-title"><div class="dot" id="detail-dot"></div><span id="detail-name"></span></div>
          <table class="detail-table">
            <tr><td>Temperature</td><td id="detail-temp">--</td></tr>
            <tr><td>Humidite relative</td><td id="detail-hr">--</td></tr>
            <tr><td>Humidite absolue</td><td id="detail-abs">--</td></tr>
            <tr><td>Point de rosee</td><td id="detail-dew">--</td></tr>
            <tr><td>Enthalpie</td><td id="detail-enth">--</td></tr>
          </table>
        </div>
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
    this.shadowRoot.getElementById('btn-indoor').addEventListener('click', () => {
      const outdoorKeywords = ['exterieur', 'ext.', 'senas', 'garage', 'frigo', 'congelateur', 'terrain'];
      this._config.sensors.forEach((s, i) => {
        const name = (s.name || '').toLowerCase();
        const isOutdoor = outdoorKeywords.some(k => name.includes(k));
        this._visibility[i] = !isOutdoor;
      });
      this._saveVisibility();
      this._applyVisibility();
    });
    this.shadowRoot.getElementById('btn-outdoor').addEventListener('click', () => {
      const outdoorKeywords = ['exterieur', 'ext.', 'senas', 'terrain'];
      this._config.sensors.forEach((s, i) => {
        const name = (s.name || '').toLowerCase();
        const isOutdoor = outdoorKeywords.some(k => name.includes(k));
        this._visibility[i] = isOutdoor;
      });
      this._saveVisibility();
      this._applyVisibility();
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
      // Show detail panel for this point if now visible
      if (this._visibility[idx]) {
        this._showDetail(idx);
      } else {
        this._hideDetail();
      }
    });

    // Build legend items once
    this._config.sensors.forEach((sensor, idx) => {
      const color = sensor.color || pointColors[idx % pointColors.length];
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

    // Canvas setup - responsive to container width
    this._aspectRatio = 900 / height; // width/height ratio
    this._resizeCanvas();
    this._chart = new PsychroChart(this._canvas, this._config);
    this.calc = new PsychroCalc();
    // Set logical dimensions from actual container size
    const container = this.shadowRoot.querySelector('ha-card');
    const cw = Math.max((container ? container.clientWidth - 32 : 900), 280);
    this._chart.logicalWidth = cw;
    this._chart.logicalHeight = Math.round(cw / this._aspectRatio);
    this._points = [];

    // Redraw on container resize (mobile rotation, panel resize, etc.)
    this._resizeObserver = new ResizeObserver(() => {
      this._resizeCanvas();
      if (this._chart) {
        this._chart.canvas = this._canvas;
        this._drawChart();
      }
    });
    this._resizeObserver.observe(this.shadowRoot.querySelector('ha-card'));
  }

  // Called on every hass update - only updates values, never rebuilds DOM
  _updateData() {
    if (!this._hass || !this._config || !this._legendBuilt) return;

    const pointColors = [
      '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
      '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
      '#8bc34a', '#cddc39', '#ffc107', '#ff9800', '#ff5722',
      '#795548', '#607d8b'
    ];

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
        color: sensor.color || pointColors[idx % pointColors.length],
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
    const w = Math.max(container.clientWidth - 32, 280); // clientWidth includes padding, subtract it
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
  }

  _showDetail(idx) {
    const panel = this.shadowRoot.getElementById('detail-panel');
    if (!panel || !this._points || !this._points[idx]) return;
    const p = this._points[idx];
    if (p.temperature === null || p.humidity === null) return;

    const T = p.temperature;
    const HR = p.humidity;
    const R = this.calc.calcR(HR, T) * 1000; // g/kg
    const Tr = this.calc.calcTr(HR, T);
    const h = this.calc.calcEnthalpie(T, R / 1000);

    this.shadowRoot.getElementById('detail-dot').style.background = p.color;
    this.shadowRoot.getElementById('detail-name').textContent = p.name;
    this.shadowRoot.getElementById('detail-temp').textContent = T.toFixed(1) + ' \u00b0C';
    this.shadowRoot.getElementById('detail-hr').textContent = HR.toFixed(1) + ' %';
    this.shadowRoot.getElementById('detail-abs').textContent = R.toFixed(2) + ' g/kg';
    this.shadowRoot.getElementById('detail-dew').textContent = (Tr !== null ? Tr.toFixed(1) : '--') + ' \u00b0C';
    this.shadowRoot.getElementById('detail-enth').textContent = h.toFixed(1) + ' kJ/kg';

    panel.classList.add('active');
    this._selectedIdx = idx;
  }

  _hideDetail() {
    const panel = this.shadowRoot.getElementById('detail-panel');
    if (panel) panel.classList.remove('active');
    this._selectedIdx = null;
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
