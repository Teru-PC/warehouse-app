function getToken() {
  const keys = ["token", "jwt", "authToken", "access_token"];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v && String(v).trim()) return String(v).trim().replace(/^Bearer\s+/i, "");
  }
  return null;
}

async function apiJson(url) {
  const token = getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && data.message) ? data.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function qs(name) {
  return new URL(location.href).searchParams.get(name);
}

function setQs(name, value) {
  const u = new URL(location.href);
  u.searchParams.set(name, value);
  history.replaceState(null, "", u.toString());
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatHeader(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${m}/${day}（${w}）`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun
  return addDays(x, -day);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function parseIsoZ(s) {
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clearError() {
  const el = document.getElementById("errorText");
  if (el) el.textContent = "";
}

function showError(msg) {
  const el = document.getElementById("errorText");
  if (el) el.textContent = msg;
}

function getCellHeightPx() {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--cell-h").trim();
  const n = Number(String(v).replace("px",""));
  return Number.isFinite(n) && n > 0 ? n : 28;
}

function setActiveMode(mode) {
  for (const id of ["modeDay","modeWeek","mode2Week","modeMonth"]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const m = btn.getAttribute("data-mode");
    btn.classList.toggle("is-active", m === mode);
  }
}

function computeRange(anchor, mode) {
  if (mode === "day") {
    const s = startOfDay(anchor);
    return { start: s, days: 1 };
  }
  if (mode === "week") {
    const s = startOfWeek(anchor);
    return { start: s, days: 7 };
  }
  if (mode === "2week") {
    const s = startOfWeek(anchor);
    return { start: s, days: 14 };
  }
  const s = startOfMonth(anchor);
  const y = s.getFullYear();
  const m = s.getMonth();
  const next = new Date(y, m + 1, 1);
  const days = Math.round((next - s) / (24 * 60 * 60 * 1000));
  return { start: s, days };
}

function buildTimeColumn() {
  const timeCol = document.getElementById("timeCol");
  timeCol.innerHTML = "";

  const cellH = getCellHeightPx();

  for (let i = 0; i < 48; i++) {
    const h = Math.floor(i / 2);
    const mm = (i % 2) === 0 ? "00" : "30";

    const slot = document.createElement("div");
    slot.className = "cal-time-slot";
    slot.style.height = `${cellH}px`;
    slot.textContent = `${pad2(h)}:${mm}`;
    timeCol.appendChild(slot);
  }
}

function buildGridShell(rangeStart, days) {
  const header = document.getElementById("daysHeader");
  const grid = document.getElementById("daysGrid");
  header.innerHTML = "";
  grid.innerHTML = "";

  const cellH = getCellHeightPx();

  for (let di = 0; di < days; di++) {
    const date = addDays(rangeStart, di);
    const dow = date.getDay();

    const head = document.createElement("div");
    head.className = "cal-day-head";
    if (dow === 6) head.classList.add("is-sat");
    if (dow === 0) head.classList.add("is-sun");
    head.textContent = formatHeader(date);
    header.appendChild(head);

    const col = document.createElement("div");
    col.className = "cal-day-col";
    if (dow === 6) col.classList.add("is-sat");
    if (dow === 0) col.classList.add("is-sun");
    col.dataset.date = date.toISOString().slice(0, 10);

    for (let i = 0; i < 48; i++) {
      const line = document.createElement("div");
      line.className = "cal-slot-line";
      line.style.height = `${cellH}px`;
      if (i % 2 === 0) line.classList.add("hour");
      col.appendChild(line);
    }

    grid.appendChild(col);
  }
}

function minutesFromDayStart(dt, dayStart) {
  return Math.round((dt - dayStart) / 60000);
}

/* ========= 不足判定（カレンダー表示用） ========= */

function normalizeShortagesPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.shortages)) return data.shortages;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function hasShortageFromList(list) {
  for (const it of list) {
    const v = Number(it && it.shortage);
    if (Number.isFinite(v) && v > 0) return true;
  }
  return false;
}

const shortagePromiseCache = new Map();

function fetchProjectShortageFlag(projectId) {
  const id = String(projectId);
  if (shortagePromiseCache.has(id)) return shortagePromiseCache.get(id);

  const p = (async () => {
    try {
      const data = await apiJson(`/api/shortages?project_id=${encodeURIComponent(id)}`);
      const list = normalizeShortagesPayload(data);
      return hasShortageFromList(list);
    } catch {
      return false;
    }
  })();

  shortagePromiseCache.set(id, p);
  return p;
}

function computeVisibleProjects(projects, rangeStart, days) {
  const cols = Array.from(document.querySelectorAll(".cal-day-col"));
  const rangeEnd = addDays(rangeStart, days);
  const visible = [];

  for (const p of projects) {
    const sRaw = p.usage_start_at ?? p.usage_start;
    const eRaw = p.usage_end_at ?? p.usage_end;
    const s = parseIsoZ(sRaw);
    const e = parseIsoZ(eRaw);
    if (!s || !e) continue;

    if (e <= rangeStart || s >= rangeEnd) continue;

    const dayKey = startOfDay(s).toISOString().slice(0, 10);
    const col = cols.find(c => c.dataset.date === dayKey);
    if (!col) continue;

    visible.push(p);
  }

  return visible;
}

async function computeShortageIdSetForVisibleProjects(projects, rangeStart, days) {
  const visible = computeVisibleProjects(projects, rangeStart, days);
  const ids = Array.from(new Set(visible.map(p => p.id).filter(v => v !== null && v !== undefined)));

  const shortageFlags = await Promise.all(ids.map(id => fetchProjectShortageFlag(id)));

  const set = new Set();
  for (let i = 0; i < ids.length; i++) {
    if (shortageFlags[i]) set.add(String(ids[i]));
  }
  return set;
}

/* ========= 案件クリック用モーダル ========= */

function ensureProjectModal() {
  let overlay = document.getElementById("projectModalOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "projectModalOverlay";
  overlay.className = "cal-modal-overlay";
  overlay.innerHTML = `
    <div class="cal-modal" role="dialog" aria-modal="true" aria-labelledby="calModalTitle">
      <div class="cal-modal-title" id="calModalTitle">案件</div>
      <div class="cal-modal-actions">
        <button type="button" class="cal-modal-btn" id="calModalEditBtn">編集へ</button>
        <button type="button" class="cal-modal-btn cal-modal-btn--primary" id="calModalItemsBtn">機材割当へ</button>
      </div>
      <div class="cal-modal-actions" style="justify-content:flex-end; margin-top:10px;">
        <button type="button" class="cal-modal-btn" id="calModalCloseBtn">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("is-open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.classList.remove("is-open");
  });

  return overlay;
}

function openProjectModal(projectId, title, returnUrl) {
  const overlay = ensureProjectModal();
  const t = overlay.querySelector("#calModalTitle");
  const editBtn = overlay.querySelector("#calModalEditBtn");
  const itemsBtn = overlay.querySelector("#calModalItemsBtn");
  const closeBtn = overlay.querySelector("#calModalCloseBtn");

  t.textContent = title ? `案件：${title}` : "案件";

  editBtn.onclick = () => {
    location.href = `/project-edit.html?project_id=${encodeURIComponent(projectId)}&return=${encodeURIComponent(returnUrl)}`;
  };

  itemsBtn.onclick = () => {
    location.href = `/project-items.html?project_id=${encodeURIComponent(projectId)}&return=${encodeURIComponent(returnUrl)}`;
  };

  closeBtn.onclick = () => overlay.classList.remove("is-open");

  overlay.classList.add("is-open");
}

/* ========= 重なりレイアウト（同日内で横並び） ========= */

function layoutOverlaps(dayEvents) {
  // dayEvents: [{ id, startMin, endMin, p, ... }]
  // 返す: 同じ配列に colIndex / colCount を付与
  const evs = [...dayEvents].sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin));

  let active = [];            // { endMin, colIndex, ref }
  let freeCols = [];          // number[]
  let nextCol = 0;

  let group = [];             // 現在の重なりグループ
  let groupMaxCols = 0;

  function releaseEnded(curStart) {
    // curStart 以前に終了したものを開放
    const still = [];
    for (const a of active) {
      if (a.endMin <= curStart) {
        freeCols.push(a.colIndex);
      } else {
        still.push(a);
      }
    }
    active = still;
    freeCols.sort((x,y)=>x-y);
  }

  function finalizeGroup() {
    if (!group.length) return;
    for (const e of group) e.colCount = Math.max(1, groupMaxCols);
    group = [];
    groupMaxCols = 0;
  }

  for (const e of evs) {
    releaseEnded(e.startMin);

    // activeが空なら、新しいグループ開始
    if (active.length === 0) {
      finalizeGroup();
      nextCol = 0;
      freeCols = [];
    }

    const colIndex = freeCols.length ? freeCols.shift() : nextCol++;
    e.colIndex = colIndex;

    group.push(e);

    active.push({ endMin: e.endMin, colIndex, ref: e });

    // 同時重なり数＝activeの数。最大をcolCountにする（Googleの横並びの基本）
    groupMaxCols = Math.max(groupMaxCols, active.length);
  }

  finalizeGroup();
  return evs;
}

/* ========= 描画 ========= */

function renderProjects(projects, rangeStart, days, shortageIdSet) {
  const cols = Array.from(document.querySelectorAll(".cal-day-col"));
  const cellH = getCellHeightPx();
  const minutesPerCell = 30;

  for (const col of cols) {
    const old = Array.from(col.querySelectorAll(".cal-project"));
    for (const el of old) el.remove();
  }

  const rangeEnd = addDays(rangeStart, days);
  const returnUrl = location.pathname + location.search;

  // 1) 日ごとにイベントを集める（開始日基準：現仕様に合わせる）
  const byDay = new Map(); // dayKey -> { colEl, events: [] }

  for (const p of projects) {
    const sRaw = p.usage_start_at ?? p.usage_start;
    const eRaw = p.usage_end_at ?? p.usage_end;

    const s = parseIsoZ(sRaw);
    const e = parseIsoZ(eRaw);
    if (!s || !e) continue;

    if (e <= rangeStart || s >= rangeEnd) continue;

    const dayKey = startOfDay(s).toISOString().slice(0, 10);
    const col = cols.find(c => c.dataset.date === dayKey);
    if (!col) continue;

    const dayStart = startOfDay(s);

    const startMin = clamp(minutesFromDayStart(s, dayStart), 0, 24 * 60);
    const endMin = clamp(minutesFromDayStart(e, dayStart), 0, 24 * 60);

    if (!byDay.has(dayKey)) byDay.set(dayKey, { colEl: col, events: [] });
    byDay.get(dayKey).events.push({ p, startMin, endMin });
  }

  // 2) 日ごとに重なりレイアウトを計算して描画
  for (const { colEl, events } of byDay.values()) {
    const laid = layoutOverlaps(events.map(e => ({
      p: e.p,
      startMin: e.startMin,
      endMin: e.endMin,
      colIndex: 0,
      colCount: 1
    })));

    const innerW = Math.max(0, colEl.clientWidth - 12); // 左右6pxを引いた内側
    const gap = 6;

    for (const e of laid) {
      const p = e.p;

      const top = Math.floor(e.startMin / minutesPerCell) * cellH + (e.startMin % minutesPerCell) * (cellH / minutesPerCell);
      const height = Math.max(10, (e.endMin - e.startMin) * (cellH / minutesPerCell));

      const colsCount = Math.max(1, e.colCount);
      const idx = Math.max(0, e.colIndex);

      const w = colsCount === 1 ? innerW : Math.max(40, Math.floor((innerW - gap * (colsCount - 1)) / colsCount));
      const left = 6 + idx * (w + gap);

      const block = document.createElement("div");
      block.className = "cal-project";
      block.classList.add(p.status || "draft");

      const pid = String(p.id);
      block.dataset.projectId = pid;

      if (shortageIdSet && shortageIdSet.has(pid)) {
        block.classList.add("cal-project--shortage");
      }

      block.style.top = `${top}px`;
      block.style.height = `${height}px`;

      // 横並びレイアウト（rightは使わない）
      block.style.left = `${left}px`;
      block.style.width = `${w}px`;
      block.style.right = "auto";

      block.textContent = p.title ?? "(無題)";

      block.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openProjectModal(p.id, p.title ?? "(無題)", returnUrl);
      });

      colEl.appendChild(block);
    }
  }
}

function isoDateForInput(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = pad2(x.getMonth() + 1);
  const day = pad2(x.getDate());
  return `${y}-${m}-${day}`;
}

let anchorDate = new Date();
let mode = qs("mode") || "week";

async function load() {
  clearError();

  setActiveMode(mode);

  const datePicker = document.getElementById("datePicker");
  if (datePicker) datePicker.value = isoDateForInput(anchorDate);

  const range = computeRange(anchorDate, mode);

  buildTimeColumn();
  buildGridShell(range.start, range.days);

  const projects = await apiJson("/api/projects");

  let shortageIdSet = null;
  try {
    shortageIdSet = await computeShortageIdSetForVisibleProjects(projects, range.start, range.days);
  } catch {
    shortageIdSet = null;
  }

  renderProjects(projects, range.start, range.days, shortageIdSet);
}

function shiftAnchor(dir) {
  if (mode === "day") anchorDate = addDays(anchorDate, dir * 1);
  else if (mode === "week") anchorDate = addDays(anchorDate, dir * 7);
  else if (mode === "2week") anchorDate = addDays(anchorDate, dir * 14);
  else {
    const y = anchorDate.getFullYear();
    const m = anchorDate.getMonth();
    anchorDate = new Date(y, m + dir, 1);
  }
}

function wire() {
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const newBtn = document.getElementById("newBtn");
  const datePicker = document.getElementById("datePicker");

  if (prevBtn) prevBtn.addEventListener("click", () => { shiftAnchor(-1); load().catch(e => showError(e.message)); });
  if (nextBtn) nextBtn.addEventListener("click", () => { shiftAnchor(1); load().catch(e => showError(e.message)); });

  if (newBtn) newBtn.addEventListener("click", () => {
    const returnUrl = location.pathname + location.search;
    location.href = `/project-new.html?return=${encodeURIComponent(returnUrl)}`;
  });

  if (datePicker) {
    datePicker.addEventListener("change", () => {
      const v = datePicker.value;
      if (!v) return;
      const [y,m,d] = v.split("-").map(Number);
      anchorDate = new Date(y, m - 1, d);
      load().catch(e => showError(e.message));
    });
  }

  for (const id of ["modeDay","modeWeek","mode2Week","modeMonth"]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener("click", () => {
      mode = btn.getAttribute("data-mode");
      setQs("mode", mode);
      load().catch(e => showError(e.message));
    });
  }

  // 画面幅が変わると横並びのpx計算がズレるので再描画
  window.addEventListener("resize", () => {
    load().catch(()=>{});
  });
}

wire();
load().catch(err => showError(err.message));