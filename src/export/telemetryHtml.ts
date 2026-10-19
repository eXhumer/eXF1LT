import type { TelemetryReport } from './telemetry.js';

/** JSON that is safe inside a `<script>` element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Header lines name each driver in full up to this many; beyond it they shrink to codes. */
const FULL_NAMES = 2;

/**
 * A self-contained page (no network) with two views:
 *
 * - Timeline: one chart per car data channel on a shared, zoomable time axis,
 *   every driver overlaid (each can be hidden), with the reference driver's
 *   laps, track status periods and a track map that follows the pointer.
 * - Lap comparison: a reference lap and any number of other laps (of any
 *   driver, the reference's own included) against lap distance, with each
 *   one's time delta to the reference.
 *
 * A table beside the map lists every line's values under the pointer, and the
 * samples can be downloaded as CSV.
 */
export function renderTelemetryHtml(report: TelemetryReport): string {
  const tlas = report.drivers.length > 3 ? `${report.drivers.length} drivers` : report.drivers.map(({ driver }) => driver.tla).join(' vs ');
  const session = [report.session.meeting, report.session.name].filter(Boolean).join(' ');
  const title = `${tlas} telemetry · ${session}`;
  const full = report.drivers.length <= FULL_NAMES;
  const who = report.drivers
    .map(
      ({ driver }) => `<div class="who">
    <span class="tla">${escapeHtml(driver.tla)}</span>${
      full
        ? `
    <span class="num">${escapeHtml(driver.number)}</span>
    <span class="name">${escapeHtml(driver.name)}${driver.team ? ` · ${escapeHtml(driver.team)}` : ''}</span>`
        : ''
    }
  </div>`,
    )
    .join('\n  ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body style="--team:${escapeHtml(report.drivers[0]?.driver.colour ?? '#e10600')}">
<header>
  <div class="drivers${full ? '' : ' compact'}">
  ${who}
  </div>
  <div class="session">${escapeHtml(report.session.meeting)}${report.session.name ? ` · ${escapeHtml(report.session.name)}` : ''}</div>
</header>
<div class="toolbar">
  <div class="tabs" role="tablist">
    <button type="button" role="tab" data-mode="time">Timeline</button>
    <button type="button" role="tab" data-mode="compare">Lap comparison</button>
  </div>
  <div class="controls" id="time-controls">
    <label>Zoom to <select id="lap"><option value="">Whole session</option></select></label>
  </div>
  <button id="reset" type="button">Reset zoom</button>
  <button id="csv" type="button">Download CSV</button>
</div>
<div class="toggles" id="toggles"></div>
<div class="key" id="key"></div>
<div class="compare" id="compare-controls">
  <div class="entries" id="entries"></div>
  <button id="add" type="button">+ Add lap</button>
</div>
<div class="hint" id="hint"></div>
<div class="readout" id="readout"></div>
<main>
  <div class="charts" id="charts"></div>
  <aside>
    <canvas id="map"></canvas>
    <div class="legend" id="legend"></div>
    <table class="values" id="values"></table>
  </aside>
</main>
<script id="data" type="application/json">${scriptJson(report)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const STYLE = `
:root {
  --bg: #f6f6f8; --panel: #ffffff; --text: #15151e; --muted: #6b6b78; --grid: #e4e4ea;
  --lap: #b8b8c4; --part: #15151e;
  --yellow: rgba(255, 209, 46, .22); --double-yellow: rgba(255, 196, 0, .5); --vsc: rgba(255, 159, 10, .2);
  --sc: rgba(255, 120, 0, .32); --red: rgba(232, 0, 45, .25);
  --ahead: rgba(0, 160, 90, .12); --behind: rgba(232, 0, 45, .1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101018; --panel: #15151e; --text: #f0f0f4; --muted: #8d8d9c; --grid: #262634;
    --lap: #3c3c4e; --part: #f0f0f4;
    --yellow: rgba(255, 209, 46, .13); --double-yellow: rgba(255, 196, 0, .34); --vsc: rgba(255, 159, 10, .15);
    --sc: rgba(255, 120, 0, .26); --red: rgba(232, 0, 45, .28);
    --ahead: rgba(0, 200, 110, .12); --behind: rgba(255, 60, 80, .12);
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center;
  padding: 14px 16px 10px; border-left: 6px solid var(--team); background: var(--panel); }
.drivers { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.drivers.compact { gap: 2px 12px; }
.drivers.compact .tla { font-size: 16px; }
.who { display: flex; gap: 8px; align-items: baseline; }
.tla { font-size: 22px; font-weight: 800; letter-spacing: .04em; }
.num { font-weight: 700; color: var(--muted); }
.name, .session, .hint { color: var(--muted); }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 16px 4px; }
.controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tabs { display: flex; border: 1px solid var(--grid); border-radius: 6px; overflow: hidden; }
.tabs button { border: 0; border-radius: 0; }
.tabs button[aria-selected="true"] { background: var(--text); color: var(--panel); }
select, button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--grid);
  border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover, select:hover { border-color: var(--muted); }
button:disabled { opacity: .45; cursor: default; }
.line { display: inline-block; width: 18px; border-top: 3px solid; vertical-align: middle; }
.key { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 2px 16px; color: var(--muted); font-size: 12px; }
.key span { display: inline-flex; gap: 5px; align-items: center; }
.key i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; }
.key i.part { width: 2px; height: 12px; background: var(--part); }
.toggles { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 16px; }
.toggles button { display: flex; gap: 6px; align-items: center; padding: 3px 8px; }
.toggles button[aria-pressed="false"] { opacity: .4; }
.compare { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px 16px; }
.entries { display: flex; flex-wrap: wrap; gap: 6px; }
.entry { display: flex; gap: 4px; align-items: center; padding: 3px 6px; border: 1px solid var(--grid); border-radius: 8px; background: var(--panel); }
.entry.ref { border-color: var(--muted); }
.entry .role { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.entry select { padding: 2px 6px; }
.entry button { padding: 2px 7px; }
.hint { padding: 2px 16px 6px; font-size: 12px; }
.readout { padding: 0 16px 8px; min-height: 26px; font-variant-numeric: tabular-nums; }
.readout span { color: var(--muted); }
main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 12px; padding: 0 16px 16px; }
@media (max-width: 900px) { main { grid-template-columns: minmax(0, 1fr); } aside { order: -1; } }
.charts { background: var(--panel); border-radius: 8px; padding: 6px 0; cursor: crosshair; user-select: none; touch-action: none; }
.charts.dragging { cursor: grabbing; }
.charts canvas { display: block; width: 100%; }
aside { background: var(--panel); border-radius: 8px; padding: 10px; align-self: start; position: sticky; top: 12px;
  max-height: calc(100vh - 24px); overflow: auto; }
#map { display: block; width: 100%; aspect-ratio: 1; }
.legend { color: var(--muted); font-size: 12px; margin: 6px 0 8px; }
.values { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.values th { color: var(--muted); font-weight: 500; text-align: right; padding: 2px 4px; border-bottom: 1px solid var(--grid); }
.values td { text-align: right; padding: 2px 4px; white-space: nowrap; }
.values th:first-child, .values td:first-child { text-align: left; }
.values td:first-child b { margin-left: 4px; }
`;

// Runs in the browser. Plain ES2020 without template literals, so it can sit
// inside this file's template string as it is.
const SCRIPT = `
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  var drivers = data.drivers;
  var css = getComputedStyle(document.documentElement);
  function token(name) { return css.getPropertyValue(name).trim(); }
  function $(id) { return document.getElementById(id); }
  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function lowerBound(list, v) { var lo = 0, hi = list.length; while (lo < hi) { var m = (lo + hi) >> 1; if (list[m] < v) lo = m + 1; else hi = m; } return lo; }
  function upperBound(list, v) { var lo = 0, hi = list.length; while (lo < hi) { var m = (lo + hi) >> 1; if (list[m] <= v) lo = m + 1; else hi = m; } return lo; }
  function nearest(list, v) {
    var i = lowerBound(list, v);
    if (i <= 0) return 0;
    if (i >= list.length) return list.length - 1;
    return v - list[i - 1] <= list[i] - v ? i - 1 : i;
  }
  /** The value at v on a sorted x list: interpolated, or held for stepped channels. */
  function valueAt(xs, values, v, step) {
    var i = upperBound(xs, v);
    if (i <= 0) return values[0];
    if (i >= xs.length) return values[xs.length - 1];
    if (step) return values[i - 1];
    var a = xs[i - 1], b = xs[i];
    return b === a ? values[i] : values[i - 1] + (values[i] - values[i - 1]) * (v - a) / (b - a);
  }
  function niceCeil(value) {
    var p = Math.pow(10, Math.floor(Math.log10(value)));
    var n = value / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function clock(t, withMs) {
    var d = new Date(data.origin + t + data.session.offsetMs);
    var s = pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2);
    return withMs ? s + '.' + pad(d.getUTCMilliseconds(), 3) : s;
  }
  function lapClock(ms) {
    var m = Math.floor(ms / 60000), s = (ms - m * 60000) / 1000;
    return (m ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(3);
  }
  function distance(m) { return m >= 1000 ? (m / 1000).toFixed(m % 1000 ? 2 : 0) + ' km' : Math.round(m) + ' m'; }
  function signed(s) { return (s > 0 ? '+' : s < 0 ? '−' : '±') + Math.abs(s).toFixed(3); }
  function escapeText(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // ── Line styles ────────────────────────────────────────────────────────
  // Team-mates share a colour, and so do two laps of one driver. A line whose
  // colour is close to an earlier line's is drawn dashed (then dotted, then
  // dash-dot) in a shade pulled towards the text colour.
  function rgb(hex) { var n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function close(a, b) { var x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 90; }
  function mix(a, b, f) {
    var x = rgb(a), y = rgb(b);
    return '#' + x.map(function (v, i) { return pad(Math.round(v + (y[i] - v) * f).toString(16), 2); }).join('');
  }
  var DASHES = [[], [6, 3], [1.5, 3], [8, 3, 1.5, 3]];
  var CSS_DASH = ['solid', 'dashed', 'dotted', 'dashed'];
  function styles(colours) {
    var text = token('--text');
    return colours.map(function (colour, i) {
      var k = 0;
      for (var j = 0; j < i; j++) if (close(colours[j], colour)) k++;
      return { colour: k ? mix(colour, text, Math.min(0.6, 0.3 * k)) : colour, dash: DASHES[k % DASHES.length], css: CSS_DASH[k % CSS_DASH.length] };
    });
  }
  function swatch(style) { return '<span class="line" style="border-top-color:' + style.colour + ';border-top-style:' + style.css + '"></span>'; }
  var driverStyles = styles(drivers.map(function (d) { return d.driver.colour; }));

  // ── Channels and laps ─────────────────────────────────────────────────
  var hasDrs = drivers.some(function (d) { return d.car.drs; });
  var channels = [
    { key: 'speed', label: 'Speed', short: 'km/h', unit: 'km/h', height: 170, max: null },
    { key: 'throttle', label: 'Throttle', short: 'Thr', unit: '%', height: 100, max: 100 },
    { key: 'brake', label: 'Brake', short: 'Brk', unit: '', height: 70, max: null, step: true },
    { key: 'gear', label: 'Gear', short: 'G', unit: '', height: 90, max: 8, step: true },
    { key: 'rpm', label: 'RPM', short: 'RPM', unit: '', height: 120, max: null },
  ];
  if (hasDrs) channels.push({ key: 'drs', label: 'DRS', short: 'DRS', unit: '', height: 60, max: null, step: true });
  channels.forEach(function (ch) {
    if (ch.max !== null) return;
    var max = 0;
    drivers.forEach(function (d) { var v = d.car[ch.key] || []; for (var i = 0; i < v.length; i++) if (v[i] > max) max = v[i]; });
    ch.max = niceCeil(max || 1);
  });

  function lapMs(lap) { return lap.end - lap.start; }
  /** A lap can be compared when its start is known and the car data covers it. */
  function usable(d, lap) {
    if (lap.start === undefined || lap.start === null) return false;
    var t = drivers[d].car.t;
    return lowerBound(t, lap.end) - upperBound(t, lap.start) >= 8;
  }
  function usableLaps(d) { return drivers[d].laps.filter(function (lap) { return usable(d, lap); }); }
  /** The driver's fastest timed lap not in 'except', else any usable lap not in it. */
  function fastest(d, except) {
    except = except || [];
    var free = usableLaps(d).filter(function (lap) { return except.indexOf(lap) < 0; });
    var best = null;
    free.forEach(function (lap) { if (lap.time && (!best || lapMs(lap) < lapMs(best))) best = lap; });
    return best || free[0] || null;
  }
  function lapOf(d, n) { return drivers[d].laps.find(function (lap) { return lap.lap === n; }) || null; }
  var lapEnds = drivers.map(function (d) { return d.laps.map(function (lap) { return lap.end; }); });
  /** The lap driver d was on at t: one more than the laps completed by then. */
  function lapIndexAt(d, t) { return upperBound(lapEnds[d], t) + 1; }

  // ── Lap comparison ─────────────────────────────────────────────────────
  /**
   * A lap against distance: samples at the lap's start, inside it and at its
   * end, with distance integrated from speed (trapezoids).
   */
  function trace(entry) {
    var car = drivers[entry.driver].car, lap = entry.lap, times = [lap.start];
    for (var i = upperBound(car.t, lap.start); i < car.t.length && car.t[i] < lap.end; i++) times.push(car.t[i]);
    times.push(lap.end);
    var out = { driver: entry.driver, lap: lap, t: [], d: [] }, dist = 0;
    channels.forEach(function (ch) { out[ch.key] = []; });
    times.forEach(function (t, j) {
      channels.forEach(function (ch) { out[ch.key].push(car[ch.key] ? valueAt(car.t, car[ch.key], t, ch.step) : 0); });
      if (j > 0) dist += (out.speed[j - 1] + out.speed[j]) / 2 / 3.6 * (t - times[j - 1]) / 1000;
      out.t.push(t - lap.start);
      out.d.push(dist);
    });
    out.length = dist;
    return out;
  }

  /** entries[0] is the reference; the others are compared with it. */
  var entries = [];
  var compare = null;
  /**
   * Every lap scaled to the reference's length, so the same corner sits at
   * the same distance, and each other lap's delta to the reference (seconds,
   * positive when behind) on a fine distance grid. The delta at the line is
   * the lap time difference.
   */
  function buildCompare() {
    if (entries.length < 2) { compare = null; return; }
    var traces = entries.map(trace), length = traces[0].length;
    traces.forEach(function (tr) { var k = tr.length ? length / tr.length : 1; tr.d = tr.d.map(function (v) { return v * k; }); });
    var grid = [], steps = 1500;
    for (var i = 0; i <= steps; i++) grid.push((length * i) / steps);
    var deltas = traces.map(function (tr, n) {
      if (n === 0) return null;
      return grid.map(function (g) { return (valueAt(tr.d, tr.t, g) - valueAt(traces[0].d, traces[0].t, g)) / 1000; });
    });
    var lineStyles = styles(entries.map(function (e) { return drivers[e.driver].driver.colour; }));
    compare = { traces: traces, length: length, grid: grid, deltas: deltas, styles: lineStyles };
  }

  // ── State ──────────────────────────────────────────────────────────────
  var mode = 'time';
  var visible = drivers.map(function () { return true; });
  var timeFull = (function () {
    var lo = Infinity, hi = -Infinity;
    drivers.forEach(function (d) {
      [d.car.t, d.position.t].forEach(function (t) { if (t.length) { lo = Math.min(lo, t[0]); hi = Math.max(hi, t[t.length - 1]); } });
    });
    return [lo, hi];
  })();
  function full() { return mode === 'time' ? timeFull : [0, compare ? compare.length : 1]; }
  var view = timeFull.slice();
  var hover = null;
  function minSpan() { return mode === 'time' ? 2000 : 50; }

  // ── Timeline controls ──────────────────────────────────────────────────
  var lapSelect = $('lap');
  data.parts.forEach(function (part) {
    var option = make('option', '', part.label);
    option.value = 'part:' + part.part;
    lapSelect.appendChild(option);
  });
  drivers[0].laps.forEach(function (lap) {
    var option = make('option', '', drivers[0].driver.tla + ' lap ' + lap.lap + (lap.time ? ' · ' + lap.time : ''));
    option.value = String(lap.lap);
    lapSelect.appendChild(option);
  });
  function showLap(n) {
    var lap = lapOf(0, n);
    if (!lap) return;
    var start = lap.start !== undefined && lap.start !== null ? lap.start : Math.max(timeFull[0], lap.end - 180000);
    var margin = (lap.end - start) * 0.02;
    setView(start - margin, lap.end + margin);
    lapSelect.value = String(n);
  }
  function showPart(n) {
    var part = data.parts.find(function (p) { return p.part === n; });
    if (!part) return;
    var margin = (part.to - part.from) * 0.02;
    setView(part.from - margin, part.to + margin);
    lapSelect.value = 'part:' + n;
  }
  lapSelect.addEventListener('change', function () {
    var value = lapSelect.value;
    if (value.indexOf('part:') === 0) showPart(Number(value.slice(5)));
    else if (value) showLap(Number(value));
    else reset();
  });

  // Track conditions: which band colour is which, for the conditions this session had.
  var CONDITIONS = { yellow: 'Yellow', 'double-yellow': 'Double yellow', vsc: 'VSC', sc: 'Safety car', red: 'Red flag' };
  function conditionAt(t) {
    for (var i = 0; i < data.status.length; i++) if (data.status[i].from <= t && t < data.status[i].to) return data.status[i].kind;
    return null;
  }
  function partAt(t) {
    for (var i = 0; i < data.parts.length; i++) if (data.parts[i].from <= t && t <= data.parts[i].to) return data.parts[i];
    return null;
  }
  var keyEmpty = true;
  (function () {
    var key = $('key'), html = '';
    Object.keys(CONDITIONS).forEach(function (kind) {
      if (!data.status.some(function (period) { return period.kind === kind; })) return;
      html += '<span><i style="background:var(--' + kind + ')"></i>' + CONDITIONS[kind] + '</span>';
    });
    if (data.parts.length) {
      html += '<span><i class="part"></i>' + data.parts.map(function (part) { return part.label; }).join(' / ') + ' start (dashed: end)</span>';
    }
    key.innerHTML = html;
    keyEmpty = !html;
  })();

  var toggles = $('toggles');
  if (drivers.length > 1) {
    drivers.forEach(function (d, i) {
      var button = make('button');
      button.type = 'button';
      button.innerHTML = swatch(driverStyles[i]) + escapeText(d.driver.tla);
      button.title = 'Show or hide ' + d.driver.tla + ' (double-click: only ' + d.driver.tla + ')';
      button.setAttribute('aria-pressed', 'true');
      button.addEventListener('click', function () { visible[i] = !visible[i]; syncToggles(); });
      button.addEventListener('dblclick', function () { visible = drivers.map(function (_, j) { return j === i; }); syncToggles(); });
      toggles.appendChild(button);
    });
    var all = make('button', '', 'All');
    all.type = 'button';
    all.addEventListener('click', function () { visible = drivers.map(function () { return true; }); syncToggles(); });
    toggles.appendChild(all);
  }
  function syncToggles() {
    Array.prototype.forEach.call(toggles.children, function (button, i) {
      if (i < drivers.length) button.setAttribute('aria-pressed', String(visible[i]));
    });
    schedule();
  }

  // ── Comparison controls ────────────────────────────────────────────────
  var entriesEl = $('entries');
  function renderEntries() {
    entriesEl.innerHTML = '';
    entries.forEach(function (entry, n) {
      var row = make('div', n === 0 ? 'entry ref' : 'entry');
      var style = compare ? compare.styles[n] : driverStyles[entry.driver];
      row.innerHTML = swatch(style) + '<span class="role">' + (n === 0 ? 'Ref' : 'vs') + '</span>';
      var driverSelect = make('select');
      driverSelect.setAttribute('aria-label', n === 0 ? 'Reference driver' : 'Comparison driver');
      drivers.forEach(function (d, i) {
        var option = make('option', '', d.driver.tla);
        option.value = String(i);
        driverSelect.appendChild(option);
      });
      driverSelect.value = String(entry.driver);
      driverSelect.hidden = drivers.length < 2;
      driverSelect.addEventListener('change', function () {
        var d = Number(driverSelect.value), lap = fastest(d, usedLaps(d, n));
        if (lap) setEntry(n, { driver: d, lap: lap });
      });
      var lapSelectEl = make('select');
      lapSelectEl.setAttribute('aria-label', n === 0 ? 'Reference lap' : 'Comparison lap');
      usableLaps(entry.driver).forEach(function (lap) {
        var option = make('option', '', 'L' + lap.lap + ' · ' + (lap.time || lapClock(lapMs(lap)) + '*'));
        option.value = String(lap.lap);
        lapSelectEl.appendChild(option);
      });
      lapSelectEl.value = String(entry.lap.lap);
      lapSelectEl.addEventListener('change', function () {
        setEntry(n, { driver: entry.driver, lap: lapOf(entry.driver, Number(lapSelectEl.value)) });
      });
      row.appendChild(driverSelect);
      row.appendChild(lapSelectEl);
      if (n > 0) {
        var promote = make('button', '', '⇧');
        promote.type = 'button';
        promote.title = 'Make this the reference';
        promote.addEventListener('click', function () {
          var ref = entries[0]; entries[0] = entries[n]; entries[n] = ref;
          changed(false);
        });
        var remove = make('button', '', '✕');
        remove.type = 'button';
        remove.title = 'Remove this lap';
        remove.disabled = entries.length <= 2;
        remove.addEventListener('click', function () { entries.splice(n, 1); changed(true); });
        row.appendChild(promote);
        row.appendChild(remove);
      }
      entriesEl.appendChild(row);
    });
    $('add').disabled = !nextEntry();
  }
  /** Laps of driver d already in the comparison, other than entry n's. */
  function usedLaps(d, n) {
    return entries.filter(function (e, i) { return e.driver === d && i !== n; }).map(function (e) { return e.lap; });
  }
  /** What "+ Add lap" adds: the next driver not compared yet, else another lap of the reference driver. */
  function nextEntry() {
    for (var d = 0; d < drivers.length; d++) {
      if (entries.some(function (e) { return e.driver === d; })) continue;
      var lap = fastest(d);
      if (lap) return { driver: d, lap: lap };
    }
    var own = entries.length ? entries[0].driver : 0, more = fastest(own, usedLaps(own, -1));
    return more ? { driver: own, lap: more } : null;
  }
  function setEntry(n, entry) { entries[n] = entry; changed(true); }
  function changed(resetZoom) {
    buildCompare();
    renderEntries();
    if (resetZoom) resetView(); else schedule();
  }
  $('add').addEventListener('click', function () {
    var entry = nextEntry();
    if (entry) { entries.push(entry); changed(false); }
  });

  // Default comparison: the reference driver's fastest lap against the next
  // drivers' fastest (up to five), or one driver's two fastest laps.
  var DEFAULT_COMPARED = 5;
  (function () {
    var ref = fastest(0);
    if (!ref) return;
    entries.push({ driver: 0, lap: ref });
    for (var d = 1; d < drivers.length && entries.length <= DEFAULT_COMPARED; d++) {
      var lap = fastest(d);
      if (lap) entries.push({ driver: d, lap: lap });
    }
    if (entries.length === 1) {
      var second = fastest(0, [ref]);
      if (second) entries.push({ driver: 0, lap: second });
    }
    buildCompare();
    if (compare) renderEntries(); else entries = [];
  })();

  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-mode]'));
  tabs.forEach(function (tab) {
    if (tab.getAttribute('data-mode') === 'compare' && !compare) {
      tab.disabled = true;
      tab.title = 'Needs two laps with car data and a known start';
    }
    tab.addEventListener('click', function () { setMode(tab.getAttribute('data-mode')); });
  });
  function setMode(next) {
    if (next === 'compare' && !compare) return;
    mode = next;
    tabs.forEach(function (tab) { tab.setAttribute('aria-selected', String(tab.getAttribute('data-mode') === mode)); });
    $('time-controls').hidden = mode !== 'time';
    toggles.hidden = mode !== 'time' || drivers.length < 2;
    $('key').hidden = mode !== 'time' || keyEmpty;
    $('compare-controls').hidden = mode !== 'compare';
    $('hint').textContent = mode === 'time'
      ? 'Scroll to zoom · drag to pan · double-click to reset · [ ] previous / next lap · click a driver to hide it, double-click to show only it'
      : 'Delta above zero: that lap is behind the reference there · ⇧ makes a lap the reference · [ ] step the last lap · * no official time';
    buildPanels();
    resetView();
  }

  // ── Charts ─────────────────────────────────────────────────────────────
  var chartsEl = $('charts');
  var AXIS = 22, LEFT = 56, RIGHT = 12;
  var panels = [];
  function buildPanels() {
    chartsEl.innerHTML = '';
    var list = (mode === 'compare' ? [{ key: 'delta', label: 'Delta to reference', unit: 's', height: 150, delta: true }] : []).concat(channels);
    panels = list.map(function (ch, index) {
      var canvas = make('canvas');
      var height = ch.height + (index === list.length - 1 ? AXIS : 0);
      canvas.style.height = height + 'px';
      chartsEl.appendChild(canvas);
      return { ch: ch, canvas: canvas, height: height, plot: ch.height };
    });
  }

  function setView(a, b) {
    var f = full(), span = Math.min(Math.max(minSpan(), b - a), f[1] - f[0]);
    a = Math.max(f[0], Math.min(a, f[1] - span));
    view = [a, a + span];
    schedule();
  }
  function resetView() { view = full().slice(); hover = null; schedule(); }
  function reset() { lapSelect.value = ''; resetView(); }

  /** What a panel draws: { x, y, style, step } per line, the first drawn last (on top). */
  function seriesOf(ch) {
    if (mode === 'compare') {
      if (ch.delta) {
        return compare.traces.slice(1).map(function (tr, i) { return { x: compare.grid, y: compare.deltas[i + 1], style: compare.styles[i + 1] }; });
      }
      return compare.traces.map(function (tr, i) { return { x: tr.d, y: tr[ch.key], style: compare.styles[i], step: ch.step }; });
    }
    var lines = [];
    drivers.forEach(function (d, i) {
      if (visible[i] && d.car[ch.key]) lines.push({ x: d.car.t, y: d.car[ch.key], style: driverStyles[i], step: ch.step });
    });
    return lines;
  }

  var TIME_TICKS = [1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5];
  var DIST_TICKS = [10, 20, 50, 100, 200, 250, 500, 1000, 2000];
  function tickStep(ticks, span, width) {
    var want = span / Math.max(1, width / 90);
    for (var i = 0; i < ticks.length; i++) if (ticks[i] >= want) return ticks[i];
    return ticks[ticks.length - 1];
  }

  function deltaRange() {
    var i0 = lowerBound(compare.grid, view[0]), i1 = upperBound(compare.grid, view[1]), m = 0;
    compare.deltas.forEach(function (delta) {
      if (!delta) return;
      for (var i = i0; i < i1; i++) m = Math.max(m, Math.abs(delta[i]));
    });
    return niceCeil(Math.max(m, 0.05));
  }

  function drawPanel(panel, isLast) {
    var canvas = panel.canvas, ch = panel.ch, dpr = window.devicePixelRatio || 1;
    var width = canvas.clientWidth;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(panel.height * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var plotW = width - LEFT - RIGHT, top = 8, plotH = panel.plot - top - 6;
    var span = view[1] - view[0];
    var min = 0, max = ch.max;
    if (ch.delta) { max = deltaRange(); min = -max; }
    function x(v) { return LEFT + ((v - view[0]) / span) * plotW; }
    function y(v) { return top + plotH - ((v - min) / (max - min)) * plotH; }
    var muted = token('--muted'), grid = token('--grid');
    g.font = '11px system-ui, sans-serif';

    if (mode === 'time') {
      data.status.forEach(function (period) {
        var a = Math.max(LEFT, x(period.from)), b = Math.min(LEFT + plotW, x(period.to));
        if (b <= a) return;
        g.fillStyle = token('--' + period.kind);
        g.fillRect(a, top, Math.max(1, b - a), plotH);
      });
    }
    if (ch.delta) {
      g.fillStyle = token('--behind'); g.fillRect(LEFT, top, plotW, plotH / 2);
      g.fillStyle = token('--ahead'); g.fillRect(LEFT, top + plotH / 2, plotW, plotH / 2);
    }

    g.strokeStyle = grid; g.fillStyle = muted; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
    var rows = ch.key === 'gear' ? [0, 2, 4, 6, 8] : [0, 0.5, 1].map(function (f) { return min + f * (max - min); });
    rows.forEach(function (v) {
      var yy = Math.round(y(v)) + 0.5;
      g.beginPath(); g.moveTo(LEFT, yy); g.lineTo(LEFT + plotW, yy); g.stroke();
      g.fillText(ch.delta ? (v > 0 ? '+' : '') + Number(v.toFixed(3)) : v >= 1000 ? v / 1000 + 'k' : String(v), LEFT - 6, yy);
    });
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = muted;
    var label = ch.label + (ch.unit ? ' (' + ch.unit + ')' : '');
    if (ch.delta) label += ' · ' + drivers[entries[0].driver].driver.tla + ' L' + entries[0].lap.lap + ' · above 0: behind';
    g.fillText(label, LEFT + 4, top + 2);

    if (mode === 'time') {
      var lastLabel = -Infinity;
      g.strokeStyle = token('--lap'); g.setLineDash([3, 3]);
      drivers[0].laps.forEach(function (lap) {
        var xx = Math.round(x(lap.end)) + 0.5;
        if (xx < LEFT || xx > LEFT + plotW) return;
        g.beginPath(); g.moveTo(xx, top); g.lineTo(xx, top + plotH); g.stroke();
        if (panel === panels[0] && xx - lastLabel > 26) {
          g.fillStyle = muted; g.textAlign = 'right';
          g.fillText('L' + lap.lap, xx - 3, top + 2);
          lastLabel = xx;
        }
      });
      g.setLineDash([]);

      // Qualifying parts: a solid line where each starts, labelled, and a dashed one where it ends.
      g.strokeStyle = token('--part'); g.fillStyle = token('--part'); g.lineWidth = 1.5;
      g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'left';
      data.parts.forEach(function (part) {
        [part.from, part.to].forEach(function (t, end) {
          var px = Math.round(x(t)) + 0.5;
          if (px < LEFT || px > LEFT + plotW) return;
          g.globalAlpha = end ? 0.45 : 0.75; g.setLineDash(end ? [4, 3] : []);
          g.beginPath(); g.moveTo(px, top); g.lineTo(px, top + plotH); g.stroke();
          if (!end && panel === panels[0]) { g.globalAlpha = 1; g.fillText(part.label, px + 4, top + 16); }
        });
      });
      g.globalAlpha = 1; g.setLineDash([]); g.lineWidth = 1; g.font = '11px system-ui, sans-serif';
    }

    var lines = seriesOf(ch);
    g.save();
    g.beginPath(); g.rect(LEFT, top - 1, plotW, plotH + 2); g.clip();
    lines.slice().reverse().forEach(function (line) {
      var xs = line.x, ys = line.y;
      var i0 = Math.max(0, lowerBound(xs, view[0]) - 1), i1 = Math.min(xs.length, upperBound(xs, view[1]) + 1);
      g.strokeStyle = line.style.colour; g.lineWidth = 1.5; g.lineJoin = 'round'; g.setLineDash(line.style.dash);
      g.beginPath();
      if (i1 - i0 > plotW * 2) {
        // Many samples per pixel column: draw each column's min and max.
        var column = -1, lo = 0, hi = 0, first = true;
        for (var i = i0; i < i1; i++) {
          var c = Math.floor(x(xs[i]));
          if (c !== column) {
            if (column >= 0) { if (first) { g.moveTo(column, y(lo)); first = false; } g.lineTo(column, y(lo)); g.lineTo(column, y(hi)); }
            column = c; lo = hi = ys[i];
          } else { if (ys[i] < lo) lo = ys[i]; if (ys[i] > hi) hi = ys[i]; }
        }
        if (column >= 0) { g.lineTo(column, y(lo)); g.lineTo(column, y(hi)); }
      } else {
        for (var j = i0; j < i1; j++) {
          var px = x(xs[j]), py = y(ys[j]);
          if (j === i0) g.moveTo(px, py);
          else if (line.step) { g.lineTo(px, y(ys[j - 1])); g.lineTo(px, py); }
          else g.lineTo(px, py);
        }
      }
      g.stroke();
    });
    g.setLineDash([]);
    g.restore();

    if (hover !== null && hover >= view[0] && hover <= view[1]) {
      var hx = Math.round(x(hover)) + 0.5;
      g.strokeStyle = token('--text'); g.globalAlpha = 0.5; g.lineWidth = 1;
      g.beginPath(); g.moveTo(hx, top); g.lineTo(hx, top + plotH); g.stroke();
      g.globalAlpha = 1;
      lines.forEach(function (line) {
        g.fillStyle = line.style.colour;
        g.beginPath(); g.arc(hx, y(valueAt(line.x, line.y, hover, line.step)), 3, 0, Math.PI * 2); g.fill();
      });
    }

    if (isLast) {
      g.fillStyle = muted; g.textAlign = 'center'; g.textBaseline = 'top';
      if (mode === 'time') {
        var step = tickStep(TIME_TICKS, span, plotW), local = data.origin + data.session.offsetMs;
        for (var tick = Math.ceil((view[0] + local) / step) * step - local; tick <= view[1]; tick += step) {
          tickMark(x(tick), clock(tick, step < 1000));
        }
      } else {
        var dstep = tickStep(DIST_TICKS, span, plotW);
        for (var dt = Math.ceil(view[0] / dstep) * dstep; dt <= view[1]; dt += dstep) tickMark(x(dt), distance(dt));
      }
    }
    function tickMark(tx, text) {
      g.strokeStyle = grid; g.beginPath(); g.moveTo(tx, panel.plot - 4); g.lineTo(tx, panel.plot); g.stroke();
      g.fillText(text, tx, panel.plot + 3);
    }
  }

  // ── Track map ──────────────────────────────────────────────────────────
  var mapCanvas = $('map');
  var mapPos = (drivers.find(function (d) { return d.position.t.length; }) || drivers[0]).position;
  var bounds = (function () {
    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (var i = 0; i < mapPos.x.length; i++) {
      b.minX = Math.min(b.minX, mapPos.x[i]); b.maxX = Math.max(b.maxX, mapPos.x[i]);
      b.minY = Math.min(b.minY, mapPos.y[i]); b.maxY = Math.max(b.maxY, mapPos.y[i]);
    }
    return b;
  })();
  /** Time (report ms) at a distance into a comparison trace. */
  function traceTime(tr, dist) { return tr.lap.start + valueAt(tr.d, tr.t, dist); }
  function drawMap() {
    if (!mapPos.t.length) { mapCanvas.hidden = true; return; }
    var dpr = window.devicePixelRatio || 1, size = mapCanvas.clientWidth;
    mapCanvas.width = mapCanvas.height = Math.round(size * dpr);
    var g = mapCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var padding = 10, w = bounds.maxX - bounds.minX || 1, h = bounds.maxY - bounds.minY || 1;
    var scale = (size - 2 * padding) / Math.max(w, h);
    var ox = (size - w * scale) / 2, oy = (size - h * scale) / 2;
    function mx(v) { return ox + (v - bounds.minX) * scale; }
    function my(v) { return size - (oy + (v - bounds.minY) * scale); }
    function path(pos, from, to, colour, lineWidth) {
      var a = lowerBound(pos.t, from), b = upperBound(pos.t, to);
      if (b - a < 2) return;
      g.strokeStyle = colour; g.lineWidth = lineWidth; g.lineJoin = 'round'; g.beginPath();
      for (var i = a; i < b; i++) { if (i === a) g.moveTo(mx(pos.x[i]), my(pos.y[i])); else g.lineTo(mx(pos.x[i]), my(pos.y[i])); }
      g.stroke();
    }
    function dot(pos, t, colour) {
      if (!pos.t.length) return;
      var k = nearest(pos.t, t);
      g.fillStyle = colour; g.strokeStyle = token('--panel'); g.lineWidth = 2;
      g.beginPath(); g.arc(mx(pos.x[k]), my(pos.y[k]), 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    path(mapPos, -Infinity, Infinity, token('--grid'), 5);
    var legend;
    if (mode === 'compare') {
      var ref = compare.traces[0];
      path(drivers[ref.driver].position, traceTime(ref, view[0]), traceTime(ref, view[1]), compare.styles[0].colour, 3);
      var at = hover !== null ? hover : view[1];
      for (var i = compare.traces.length - 1; i >= 0; i--) {
        dot(drivers[compare.traces[i].driver].position, traceTime(compare.traces[i], at), compare.styles[i].colour);
      }
      legend = 'Each car where it was at the same lap distance';
    } else {
      var f = timeFull, zoomed = view[0] > f[0] || view[1] < f[1];
      if (zoomed) path(mapPos, view[0], view[1], driverStyles[0].colour, 3);
      var when = hover !== null ? hover : zoomed ? view[1] : null;
      if (when !== null) {
        for (var j = drivers.length - 1; j >= 0; j--) if (visible[j]) dot(drivers[j].position, when, driverStyles[j].colour);
      }
      legend = zoomed ? 'Highlighted: the zoomed range' : 'Zoom in to highlight a stretch of track';
    }
    $('legend').textContent = legend;
  }

  // ── Readout and values table ───────────────────────────────────────────
  function table(head, rows) {
    $('values').innerHTML = '<thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
  }
  function channelHead() { return channels.map(function (ch) { return ch.short; }); }
  function name(style, text) { return swatch(style) + '<b>' + escapeText(text) + '</b>'; }
  function drawReadout() {
    var readout = $('readout');
    if (mode === 'compare') {
      var traces = compare.traces, ref = traces[0];
      var label = function (tr) { return drivers[tr.driver].driver.tla + ' L' + tr.lap.lap; };
      if (hover === null) {
        readout.innerHTML = '<span>' + escapeText(label(ref)) + ' ' + lapClock(lapMs(ref.lap)) + ' reference · ' + distance(compare.length) + ' lap</span>';
        table(['Lap', 'Time', 'Gap'], traces.map(function (tr, i) {
          return [name(compare.styles[i], label(tr)), lapClock(lapMs(tr.lap)), i ? signed((lapMs(tr.lap) - lapMs(ref.lap)) / 1000) : '—'];
        }));
      } else {
        readout.innerHTML = '<b>' + distance(hover) + '</b>';
        table(['Lap', 'Δ s'].concat(channelHead()), traces.map(function (tr, i) {
          return [name(compare.styles[i], label(tr)), i ? signed(valueAt(compare.grid, compare.deltas[i], hover)) : '—']
            .concat(channels.map(function (ch) { return String(Math.round(valueAt(tr.d, tr[ch.key], hover, ch.step))); }));
        }));
      }
      return;
    }
    var shown = drivers.map(function (d, i) { return i; }).filter(function (i) { return visible[i]; });
    if (hover === null) {
      readout.innerHTML = '<span>' + clock(view[0]) + ' – ' + clock(view[1]) + '</span>';
      table(['Driver', 'Samples', 'Laps', 'Best'], shown.map(function (i) {
        var d = drivers[i], best = null;
        d.laps.forEach(function (lap) { if (lap.time && lap.start !== undefined && lap.start !== null && (!best || lapMs(lap) < lapMs(best))) best = lap; });
        return [name(driverStyles[i], d.driver.tla), d.car.t.length.toLocaleString(), String(d.laps.length), best ? best.time : '—'];
      }));
      return;
    }
    var context = [escapeText(drivers[0].driver.tla) + ' lap ' + lapIndexAt(0, hover)], part = partAt(hover), condition = conditionAt(hover);
    if (part) context.push(part.label);
    if (condition) context.push(CONDITIONS[condition]);
    readout.innerHTML = '<b>' + clock(hover, true) + '</b> <span>· ' + context.join(' · ') + '</span>';
    table(['Driver', 'Lap'].concat(channelHead()), shown.map(function (i) {
      var d = drivers[i], k = d.car.t.length ? nearest(d.car.t, hover) : -1;
      return [name(driverStyles[i], d.driver.tla), String(lapIndexAt(i, hover))].concat(channels.map(function (ch) {
        return k >= 0 && d.car[ch.key] ? String(d.car[ch.key][k]) : '—';
      }));
    }));
  }

  var frame = 0;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      panels.forEach(function (panel, i) { drawPanel(panel, i === panels.length - 1); });
      drawMap();
      drawReadout();
    });
  }

  // ── Pointer, zoom and pan ──────────────────────────────────────────────
  function valueAtClient(clientX) {
    var rect = chartsEl.getBoundingClientRect();
    return view[0] + ((clientX - rect.left - LEFT) / (rect.width - LEFT - RIGHT)) * (view[1] - view[0]);
  }
  var drag = null;
  chartsEl.addEventListener('pointerdown', function (event) {
    drag = { x: event.clientX, view: view.slice() };
    chartsEl.setPointerCapture(event.pointerId);
    chartsEl.classList.add('dragging');
  });
  chartsEl.addEventListener('pointermove', function (event) {
    if (drag) {
      var shift = ((event.clientX - drag.x) / (chartsEl.clientWidth - LEFT - RIGHT)) * (drag.view[1] - drag.view[0]);
      setView(drag.view[0] - shift, drag.view[1] - shift);
    }
    hover = Math.min(Math.max(valueAtClient(event.clientX), view[0]), view[1]);
    schedule();
  });
  function endDrag() { drag = null; chartsEl.classList.remove('dragging'); }
  chartsEl.addEventListener('pointerup', endDrag);
  chartsEl.addEventListener('pointercancel', endDrag);
  chartsEl.addEventListener('pointerleave', function () { if (!drag) { hover = null; schedule(); } });
  chartsEl.addEventListener('wheel', function (event) {
    event.preventDefault();
    var at = valueAtClient(event.clientX), factor = Math.pow(1.0015, event.deltaY);
    setView(at - (at - view[0]) * factor, at + (view[1] - at) * factor);
  }, { passive: false });
  chartsEl.addEventListener('dblclick', reset);
  $('reset').addEventListener('click', reset);

  function step(list, current, forward) {
    var index = list.indexOf(current);
    if (index < 0) return forward ? list[0] : list[list.length - 1];
    return list[index + (forward ? 1 : -1)];
  }
  document.addEventListener('keydown', function (event) {
    if ((event.key !== '[' && event.key !== ']') || (event.target && event.target.tagName === 'SELECT')) return;
    var forward = event.key === ']';
    if (mode === 'compare') {
      var n = entries.length - 1, last = entries[n];
      var next = step(usableLaps(last.driver), last.lap, forward);
      if (next) setEntry(n, { driver: last.driver, lap: next });
    } else {
      var current = lapSelect.value ? lapOf(0, Number(lapSelect.value)) : null;
      var lap = step(drivers[0].laps, current, forward);
      if (lap) showLap(lap.lap);
    }
  });
  new ResizeObserver(schedule).observe(chartsEl);

  // ── CSV ────────────────────────────────────────────────────────────────
  function download(fileName, lines) {
    var blob = new Blob([lines.join('\\n') + '\\n'], { type: 'text/csv' });
    var link = make('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.csv';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  $('csv').addEventListener('click', function () {
    if (mode === 'compare') {
      // Every lap and its delta to the reference on the distance grid.
      var head = ['distance_m'];
      compare.traces.forEach(function (tr, i) {
        var p = drivers[tr.driver].driver.tla + '_L' + tr.lap.lap + '_';
        if (i) head.push(p + 'delta_s');
        channels.forEach(function (ch) { head.push(p + ch.key); });
      });
      var rows = [head.join(',')];
      compare.grid.forEach(function (dist, g) {
        var row = [dist.toFixed(1)];
        compare.traces.forEach(function (tr, i) {
          if (i) row.push(compare.deltas[i][g].toFixed(3));
          channels.forEach(function (ch) { row.push(Math.round(valueAt(tr.d, tr[ch.key], dist, ch.step) * 10) / 10); });
        });
        rows.push(row.join(','));
      });
      download(document.title + ' lap comparison', rows);
      return;
    }
    var head2 = ['driver', 'utc', 'local_time', 'lap', 'speed_kmh', 'rpm', 'gear', 'throttle_pct', 'brake'];
    if (hasDrs) head2.push('drs');
    head2.push('x', 'y');
    var lines = [head2.join(',')];
    drivers.forEach(function (d, n) {
      var car = d.car, pos = d.position;
      for (var i = 0; i < car.t.length; i++) {
        var t = car.t[i];
        var row = [d.driver.tla, new Date(data.origin + t).toISOString(), clock(t, true), lapIndexAt(n, t),
          car.speed[i], car.rpm[i], car.gear[i], car.throttle[i], car.brake[i]];
        if (hasDrs) row.push(car.drs ? car.drs[i] : '');
        if (pos.t.length) { var k = nearest(pos.t, t); row.push(pos.x[k], pos.y[k]); } else row.push('', '');
        lines.push(row.join(','));
      }
    });
    download(document.title, lines);
  });

  setMode('time');
})();
`;
