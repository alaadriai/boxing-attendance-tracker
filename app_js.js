import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD5m5QOdKK6Vy5Sr0HWciuviy0rAlvsik8",
  authDomain: "boxing-tracker-8fab1.firebaseapp.com",
  projectId: "boxing-tracker-8fab1",
  storageBucket: "boxing-tracker-8fab1.firebasestorage.app",
  messagingSenderId: "285906789422",
  appId: "1:285906789422:web:8a2b773c865bea8e94ebbf"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const sessionsCol = collection(db, 'sessions');

const COURSES = [
  { id: 'c1', name: 'Boxing Level 1',      day: 1, hour: 20, min: 0,  display: 'Monday 20:00'   },
  { id: 'c2', name: 'Boxing Fitness',       day: 1, hour: 21, min: 30, display: 'Monday 21:30'   },
  { id: 'c3', name: 'Boxing Level 1 to 2', day: 4, hour: 21, min: 30, display: 'Thursday 21:30' },
];

let sessions = [];
let state = { screen: 'home', selectedCourse: null, autoDetect: true, count: 0, counterCourse: null };
let historyFilter = 'all';

// ── Sync status ──────────────────────────────────────────────────────────────
function setSyncStatus(s) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (!dot || !lbl) return;
  dot.className = '';
  if (s === 'ok')      { dot.classList.add('ok');      lbl.textContent = 'synced';     }
  else if (s === 'err'){ dot.classList.add('err');     lbl.textContent = 'offline';    }
  else                 { dot.classList.add('loading'); lbl.textContent = 'syncing…';   }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function detectCourse() {
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const c of COURSES) {
    if (c.day === day) {
      const start = c.hour * 60 + c.min;
      if (mins >= start - 60 && mins <= start + 120) return c;
    }
  }
  return null;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateInput() { return new Date().toISOString().split('T')[0]; }
function fmtTimeInput() { return new Date().toTimeString().slice(0, 5); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Navigation ───────────────────────────────────────────────────────────────
window.navigate = function (screen) {
  state.screen = screen;
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
  document.getElementById('sec-' + screen).classList.add('active');
  if (screen === 'home')    renderHome();
  if (screen === 'counter') renderCounter();
  if (screen === 'history') renderHistory(historyFilter);
  if (screen === 'stats')   renderStats();
};

// ── Home ─────────────────────────────────────────────────────────────────────
function renderHome() {
  const detected = state.autoDetect ? detectCourse() : null;
  if (!state.selectedCourse) state.selectedCourse = detected ? detected.id : COURSES[0].id;

  let html = `
    <div class="auto-detect-row">
      <span class="auto-detect-label">Auto-detect today's course</span>
      <label class="toggle">
        <input type="checkbox" id="auto-toggle" ${state.autoDetect ? 'checked' : ''} onchange="toggleAuto(this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div style="margin-bottom:8px;font-size:13px;color:var(--text3)">Select course</div>`;

  for (const c of COURSES) {
    const isDetected = detected && detected.id === c.id;
    const isSelected = state.selectedCourse === c.id;
    html += `
      <div class="course-card ${isSelected ? 'selected' : ''} ${isDetected ? 'today' : ''}" onclick="selectCourse('${c.id}')">
        <div class="course-name">${c.name}</div>
        <div class="course-time">${c.display}</div>
        ${isDetected ? '<span class="course-badge badge-today">📍 Detected today</span>' : ''}
        ${isSelected && !isDetected ? '<span class="course-badge badge-selected">✓ Selected</span>' : ''}
      </div>`;
  }

  html += `<div class="home-actions"><button class="btn btn-primary" onclick="goCounter()">🥊 Start Counting</button></div>`;
  document.getElementById('sec-home').innerHTML = html;
}

window.toggleAuto = function (val) {
  state.autoDetect = val;
  const detected = val ? detectCourse() : null;
  if (detected) state.selectedCourse = detected.id;
  renderHome();
};
window.selectCourse = function (id) { state.selectedCourse = id; renderHome(); };
window.goCounter = function () {
  state.counterCourse = COURSES.find(c => c.id === state.selectedCourse);
  state.count = 0;
  navigate('counter');
};

// ── Counter ──────────────────────────────────────────────────────────────────
function renderCounter() {
  const c = state.counterCourse || COURSES[0];
  document.getElementById('sec-counter').innerHTML = `
    <div class="counter-course">${c.name}</div>
    <div class="counter-datetime">${c.display}</div>
    <div class="count-display">
      <div class="count-num" id="count-num">${state.count}</div>
      <div class="count-label">participants</div>
    </div>
    <div class="count-btns">
      <button class="count-btn btn-minus" onclick="changeCount(-1)">－</button>
      <button class="count-btn btn-plus"  onclick="changeCount(1)">＋</button>
    </div>
    <div class="cancelled-row">
      <span class="cancelled-label">Mark as cancelled</span>
      <label class="toggle">
        <input type="checkbox" id="cancelled-toggle" onchange="toggleCancelReason(this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div id="reason-wrap" style="display:none;margin-bottom:14px">
      <div class="field-label">Cancellation reason (optional)</div>
      <input class="field-input" id="cancel-reason" type="text" placeholder="e.g. Public holiday, trainer sick…">
    </div>
    <div class="field-group">
      <div class="field-label">Date</div>
      <input class="field-input" id="session-date" type="date" value="${fmtDateInput()}">
    </div>
    <div class="field-group">
      <div class="field-label">Time</div>
      <input class="field-input" id="session-time" type="time" value="${fmtTimeInput()}">
    </div>
    <div class="field-group">
      <div class="field-label">Course</div>
      <select class="field-input" id="session-course">
        ${COURSES.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${x.name}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary" style="margin-top:8px" onclick="saveSession()">💾 Save Session</button>`;
}

window.changeCount = function (d) {
  state.count = Math.max(0, state.count + d);
  const el = document.getElementById('count-num');
  if (el) el.textContent = state.count;
};
window.toggleCancelReason = function (v) {
  const w = document.getElementById('reason-wrap');
  if (w) w.style.display = v ? 'block' : 'none';
};

window.saveSession = async function () {
  setSyncStatus('loading');
  const cancelled = document.getElementById('cancelled-toggle')?.checked || false;
  const reason    = document.getElementById('cancel-reason')?.value.trim() || '';
  const date      = document.getElementById('session-date')?.value;
  const time      = document.getElementById('session-time')?.value;
  const courseId  = document.getElementById('session-course')?.value || state.counterCourse?.id || COURSES[0].id;
  try {
    await addDoc(sessionsCol, { courseId, count: state.count, cancelled, reason, date, time, ts: serverTimestamp() });
    setSyncStatus('ok');
    showToast(cancelled ? 'Session saved as cancelled ✓' : `Saved — ${state.count} participants ✓`);
    state.count = 0;
    setTimeout(() => navigate('history'), 800);
  } catch (e) {
    setSyncStatus('err');
    showToast('Save failed — check connection');
  }
};

// ── History ──────────────────────────────────────────────────────────────────
window.renderHistory = function (filter) {
  historyFilter = filter || 'all';
  const filtered = historyFilter === 'all' ? sessions : sessions.filter(s => s.courseId === historyFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (!a.ts && !b.ts) return 0;
    if (!a.ts) return 1;
    if (!b.ts) return -1;
    return b.ts.seconds - a.ts.seconds;
  });

  let html = `
    <a href="https://hochschulsport.rwth-aachen.de/cms/hsz/das-hochschulsportzentrum/~jvfj/informationen-fuer-uebungsleitende/"
       target="_blank" class="btn btn-secondary" style="text-decoration:none;display:flex;margin-bottom:12px">
      📅 Check RWTH Schedule
    </a>
    <button class="btn btn-secondary btn-sm" style="margin-bottom:16px" onclick="exportCSV()">⬇ Export CSV</button>
    <div class="history-controls">
      <button class="filter-btn ${historyFilter === 'all' ? 'active' : ''}" onclick="renderHistory('all')">All</button>
      ${COURSES.map(c => `<button class="filter-btn ${historyFilter === c.id ? 'active' : ''}" onclick="renderHistory('${c.id}')">${c.name.replace('Boxing ', '')}</button>`).join('')}
    </div>`;

  if (!sorted.length) {
    html += `<div class="empty-state">No sessions yet.<br>Start counting! 🥊</div>`;
  } else {
    for (const s of sorted) {
      const course = COURSES.find(c => c.id === s.courseId);
      html += `
        <div class="session-item">
          <div class="session-header">
            <div>
              <div class="session-date">${fmtDate(s.date)} ${s.time || ''}</div>
              <div class="session-course">${course ? course.name : 'Unknown'}</div>
              ${s.cancelled ? `<div class="session-cancelled">⚠ Cancelled${s.reason ? ' — ' + s.reason : ''}</div>` : ''}
            </div>
            <div class="session-count">${s.cancelled ? '—' : s.count}</div>
          </div>
        </div>`;
    }
  }
  document.getElementById('sec-history').innerHTML = html;
};

// ── Stats ────────────────────────────────────────────────────────────────────
function renderStats() {
  let html = '';
  let maxAvg = 0;
  const courseStats = COURSES.map(c => {
    const s        = sessions.filter(x => x.courseId === c.id && !x.cancelled);
    const cancelled = sessions.filter(x => x.courseId === c.id && x.cancelled).length;
    const total    = s.reduce((sum, x) => sum + x.count, 0);
    const avg      = s.length ? Math.round(total / s.length) : 0;
    if (avg > maxAvg) maxAvg = avg;
    return { c, sessions: s, cancelled, avg };
  });

  for (const { c, sessions: s, cancelled, avg } of courseStats) {
    const pct = maxAvg > 0 ? Math.round(avg / maxAvg * 100) : 0;
    html += `
      <div class="stat-card">
        <div class="stat-course">${c.name}</div>
        <div class="stat-row">
          <div class="stat-box"><div class="stat-val">${avg}</div><div class="stat-lbl">Avg attendance</div></div>
          <div class="stat-box"><div class="stat-val">${s.length}</div><div class="stat-lbl">Sessions</div></div>
        </div>
        ${cancelled > 0 ? `<div style="font-size:12px;color:var(--amber);margin-top:10px">⚠ ${cancelled} cancelled</div>` : ''}
        <div class="stat-bar-wrap">
          <div class="stat-bar-label"><span>Relative avg</span><span>${avg}</span></div>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }

  if (!sessions.length) html = `<div class="empty-state">No data yet.<br>Record your first session! 🥊</div>`;
  document.getElementById('sec-stats').innerHTML = html;
}

// ── CSV Export ───────────────────────────────────────────────────────────────
window.exportCSV = function () {
  const rows = [['Course', 'Date', 'Time', 'Count', 'Cancelled', 'Reason']];
  const sorted = [...sessions].sort((a, b) => (a.ts?.seconds || 0) - (b.ts?.seconds || 0));
  for (const s of sorted) {
    const c = COURSES.find(x => x.id === s.courseId);
    rows.push([c ? c.name : s.courseId, s.date, s.time || '', s.cancelled ? '' : s.count, s.cancelled ? 'Yes' : 'No', s.reason || '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'boxing_attendance.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported ✓');
};

// ── Firestore live listener ──────────────────────────────────────────────────
function startSync() {
  const q = query(sessionsCol, orderBy('ts', 'desc'));
  onSnapshot(q, snap => {
    sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setSyncStatus('ok');
    if (state.screen === 'history') renderHistory(historyFilter);
    if (state.screen === 'stats')   renderStats();
  }, err => {
    setSyncStatus('err');
    console.error(err);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  // Try logo
  const img = new Image();
  img.onload = () => {
    const fb = document.getElementById('header-logo-fallback');
    if (fb) fb.outerHTML = `<img src="logo.jpg" alt="Logo" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`;
  };
  img.src = 'logo.jpg';

  setSyncStatus('loading');
  startSync();

  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
    renderHome();
  }, 1200);
}

init();
