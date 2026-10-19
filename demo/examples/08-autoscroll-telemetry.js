import '../../src/runway-grid.js';
import { escapeHtml } from '../assets/shared.js';

const grid = document.getElementById('telemetry-grid');
const toggleAutoscrollBtn = document.getElementById('toggle-autoscroll-btn');
const toggleStreamBtn = document.getElementById('toggle-stream-btn');
const speedButtons = document.querySelectorAll('.stream-speed-btn');
const jumpStartBtn = document.getElementById('jump-start-btn');
const jumpEndBtn = document.getElementById('jump-end-btn');
const singleEventBtn = document.getElementById('single-event-btn');
const burstBtn = document.getElementById('burst-btn');
const clearBtn = document.getElementById('clear-btn');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const rangeIndicator = document.getElementById('range-indicator');
const jumpTailBanner = document.getElementById('jump-tail-banner');
const unreadCountSpan = document.getElementById('unread-count');

// Subsystems and telemetry generators
const SUBSYSTEMS = [
  'NAV-CORE', 'PROPULSION', 'PWR-BUS-A', 'PWR-BUS-B', 'THERMAL',
  'COMM-HIGH', 'ATTITUDE', 'SENSORS', 'AVIONICS', 'ORBITAL'
];

const TEMPLATES = [
  { level: 'INFO', subsys: 'NAV-CORE', msg: 'Star tracker lock acquired on guide catalog #3928', val: () => `${(12 + Math.random() * 4).toFixed(0)} stars` },
  { level: 'METRIC', subsys: 'PROPULSION', msg: 'Thruster manifold chamber pressure nominal', val: () => `${(280 + Math.random() * 15).toFixed(1)} psi` },
  { level: 'INFO', subsys: 'PWR-BUS-A', msg: 'Solar array alpha gimbal tracking Sun vector', val: () => `+${(0.35 + Math.random() * 0.1).toFixed(2)}°/s` },
  { level: 'METRIC', subsys: 'PWR-BUS-B', msg: 'Battery module 4 state of charge and bus health', val: () => `${(94 + Math.random() * 5).toFixed(1)}%` },
  { level: 'WARN', subsys: 'THERMAL', msg: 'Radiator loop pump delta-P minor variance detected', val: () => `+${(8 + Math.random() * 5).toFixed(1)}%` },
  { level: 'INFO', subsys: 'COMM-HIGH', msg: 'Ka-band uplink carrier locked, packet sync OK', val: () => `SNR +${(22 + Math.random() * 4).toFixed(1)} dB` },
  { level: 'METRIC', subsys: 'ATTITUDE', msg: 'Reaction wheel 2 angular momentum within bounds', val: () => `${(2400 + Math.random() * 300).toFixed(0)} RPM` },
  { level: 'CRIT', subsys: 'THERMAL', msg: 'Leading-edge sensor cluster excursion transient', val: () => `${(620 + Math.random() * 120).toFixed(1)} K` },
  { level: 'INFO', subsys: 'AVIONICS', msg: 'Flight computer primary-secondary sync heartbeat', val: () => `${(1.2 + Math.random() * 0.8).toFixed(1)} ms` },
  { level: 'METRIC', subsys: 'SENSORS', msg: 'Magnetometer vector aligned with geomagnetic grid', val: () => `${(42 + Math.random() * 3).toFixed(2)} µT` },
  { level: 'INFO', subsys: 'ORBITAL', msg: 'Telemetry sequence frame checksum valid', val: () => `CRC 0x${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0')}` },
];

let globalEventSeq = 0;

function createTelemetryEvent(seq = globalEventSeq++) {
  const t = TEMPLATES[seq % TEMPLATES.length];
  const hours = String(Math.floor(seq / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seq % 3600) / 60)).padStart(2, '0');
  const seconds = String(seq % 60).padStart(2, '0');
  const millis = String((seq * 137) % 1000).padStart(3, '0');

  return {
    id: seq,
    timestamp: `T+${hours}:${minutes}:${seconds}.${millis}`,
    subsystem: t.subsys,
    level: t.level,
    message: `${t.msg} [SEQ #${seq}]`,
    metric: t.val()
  };
}

function generateInitialEvents(count = 25) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(createTelemetryEvent(i));
  }
  globalEventSeq = count;
  return list;
}

// Template renderer
grid.template = (item) => {
  if (!item) return '';
  return `
    <div class="telemetry-row">
      <span class="telemetry-ts">${escapeHtml(item.timestamp)}</span>
      <span class="telemetry-subsys">[${escapeHtml(item.subsystem)}]</span>
      <span class="telemetry-badge ${escapeHtml(item.level.toLowerCase())}">${escapeHtml(item.level)}</span>
      <span class="telemetry-msg">${escapeHtml(item.message)}</span>
      <span class="telemetry-val">${escapeHtml(item.metric)}</span>
    </div>
  `;
};

// Initial state: 25 items
grid.data = generateInitialEvents(25);

// Stream state
let streamIntervalId = null;
let streamIntervalMs = 250;
let isStreamActive = true;
let isAutoscrollEnabled = true;

// Adaptive speed calculation so it catches up smoothly when items accumulate
function updateAdaptiveSpeed() {
  if (!grid.registry) return;
  const vh = grid.viewport.clientHeight;
  const maxScroll = Math.max(0, grid.registry.get_total_height() - vh);
  const dist = maxScroll - grid._virtualScrollTop;

  if (dist > 180) {
    grid._autoScrollSpeed = Math.min(25, Math.max(3, dist / 12));
  } else if (dist > 50) {
    grid._autoScrollSpeed = Math.min(10, Math.max(2.5, dist / 15));
  } else {
    grid._autoScrollSpeed = 2.5;
  }
}

// Append new telemetry items into the live stream
function appendEvents(count = 1) {
  const newItems = [];
  for (let i = 0; i < count; i++) {
    newItems.push(createTelemetryEvent());
  }
  grid.appendData(newItems);

  if (isAutoscrollEnabled) {
    updateAdaptiveSpeed();
    if (!grid._isAutoScrolling) {
      grid.startAutoScroll(grid._autoScrollSpeed || 2.5);
    }
  }
  updateUI();
}

function startStream(intervalMs = streamIntervalMs) {
  stopStream();
  streamIntervalMs = intervalMs;
  isStreamActive = true;
  streamIntervalId = setInterval(() => {
    appendEvents(1);
  }, streamIntervalMs);
  toggleStreamBtn.textContent = '⏸ Pause Stream';
  updateUI();
}

function stopStream() {
  if (streamIntervalId !== null) {
    clearInterval(streamIntervalId);
    streamIntervalId = null;
  }
  isStreamActive = false;
  toggleStreamBtn.textContent = '▶ Resume Stream';
  updateUI();
}

// Autoscroll controls
function enableAutoscroll() {
  isAutoscrollEnabled = true;
  updateAdaptiveSpeed();
  grid.startAutoScroll(grid._autoScrollSpeed || 2.5);
  toggleAutoscrollBtn.textContent = '⏹ Stop Auto-Scroll';
  toggleAutoscrollBtn.classList.add('active');
  updateUI();
}

function disableAutoscroll() {
  isAutoscrollEnabled = false;
  grid.stopAutoScroll();
  toggleAutoscrollBtn.textContent = '▶ Follow Tail';
  toggleAutoscrollBtn.classList.remove('active');
  updateUI();
}

// Update status badges and banners
function updateUI() {
  if (!grid || !grid.registry) return;
  const vh = grid.viewport.clientHeight;
  const maxScroll = Math.max(0, grid.registry.get_total_height() - vh);
  const dist = Math.max(0, maxScroll - grid._virtualScrollTop);
  const unreadRows = Math.floor(dist / 36);

  // Status badge
  if (isAutoscrollEnabled && grid._isAutoScrolling) {
    if (grid._autoScrollPaused) {
      statusBadge.className = 'status-badge paused';
      statusText.textContent = 'PAUSED (Hovering)';
    } else {
      statusBadge.className = 'status-badge active';
      statusText.textContent = 'STREAMING (Follow Tail)';
    }
    toggleAutoscrollBtn.textContent = '⏹ Stop Auto-Scroll';
    toggleAutoscrollBtn.classList.add('active');
  } else {
    if (dist > 50) {
      statusBadge.className = 'status-badge paused';
      statusText.textContent = 'AUTOSCROLL OFF (Scrolled Up)';
    } else {
      statusBadge.className = 'status-badge stopped';
      statusText.textContent = isStreamActive ? 'STREAMING (Autoscroll Off)' : 'PAUSED';
    }
    toggleAutoscrollBtn.textContent = '▶ Follow Tail';
    toggleAutoscrollBtn.classList.remove('active');
  }

  // Floating unread banner when scrolled up
  if (unreadRows >= 2 && (!isAutoscrollEnabled || grid._autoScrollPaused || !grid._isAutoScrolling)) {
    unreadCountSpan.textContent = `${unreadRows} new events`;
    jumpTailBanner.style.display = 'flex';
  } else {
    jumpTailBanner.style.display = 'none';
  }

  // Range indicator
  if (grid._bufferedRange) {
    rangeIndicator.textContent = `Rows ${grid._bufferedRange.startRow} - ${grid._bufferedRange.endRow} (of ${grid.rowCount})`;
  } else {
    rangeIndicator.textContent = `${grid.rowCount} events loaded`;
  }
}

// Listen to rangechange to update range text & adaptive speed
grid.addEventListener('rangechange', (e) => {
  rangeIndicator.textContent = `Rows ${e.buffered.startRow} - ${e.buffered.endRow} (of ${grid.rowCount})`;
  updateAdaptiveSpeed();
  updateUI();
});

// Auto-start once WASM is ready
function initDemo() {
  grid.scrollToIndex(grid.rowCount - 1);
  enableAutoscroll();
  startStream(250);
}

if (grid.registry) {
  initDemo();
} else {
  grid.addEventListener('rangechange', () => {
    initDemo();
  }, { once: true });
}

// User interactions
toggleAutoscrollBtn.addEventListener('click', () => {
  if (isAutoscrollEnabled && grid._isAutoScrolling) {
    disableAutoscroll();
  } else {
    enableAutoscroll();
    grid.scrollToIndex(grid.rowCount - 1);
  }
});

toggleStreamBtn.addEventListener('click', () => {
  if (isStreamActive) {
    stopStream();
  } else {
    startStream(streamIntervalMs);
  }
});

speedButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    speedButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const interval = parseInt(btn.dataset.interval, 10);
    startStream(interval);
  });
});

singleEventBtn.addEventListener('click', () => {
  appendEvents(1);
});

burstBtn.addEventListener('click', () => {
  appendEvents(5);
});

jumpStartBtn.addEventListener('click', () => {
  disableAutoscroll();
  grid.scrollToIndex(0);
});

jumpEndBtn.addEventListener('click', () => {
  grid.scrollToIndex(grid.rowCount - 1);
  enableAutoscroll();
});

jumpTailBanner.addEventListener('click', () => {
  grid.scrollToIndex(grid.rowCount - 1);
  enableAutoscroll();
});

clearBtn.addEventListener('click', () => {
  grid.data = generateInitialEvents(15);
  grid.scrollToIndex(grid.rowCount - 1);
  enableAutoscroll();
});

// Hover and wheel events
grid.addEventListener('mouseenter', () => {
  updateUI();
});

grid.addEventListener('mouseleave', () => {
  if (isAutoscrollEnabled) {
    updateAdaptiveSpeed();
  }
  updateUI();
});

grid.addEventListener('wheel', () => {
  // Wheel stops autoscroll in grid
  isAutoscrollEnabled = false;
  updateUI();
});

// Periodic sync for UI badge state
setInterval(updateUI, 200);
