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
  // 例: "2026-02-20T01:00:00.000Z"
  // new Date() でそのまま扱う（手動補正しない）
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
  // month: 日付は「その月の1日から、最大31日」表示（簡易）
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

    // 背景のスロット線
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

function renderProjects(projects, rangeStart, days) {
  const cols = Array.from(document.querySelectorAll(".cal-day-col"));
  const cellH = getCellHeightPx();
  const minutesPerCell = 30;

  // 既存ブロックを消す（slot線は残す）
  for (const col of cols) {
    const old = Array.from(col.querySelectorAll(".cal-project"));
    for (const el of old) el.remove();
  }

  const rangeEnd = addDays(rangeStart, days);

  for (const p of projects) {
    const sRaw = p.usage_start_at ?? p.usage_start;
    const eRaw = p.usage_end_at ?? p.usage_end;

    const s = parseIsoZ(sRaw);
    const e = parseIsoZ(eRaw);
    if (!s || !e) continue;

    // 表示範囲と無関係ならスキップ（ざっくり）
    if (e <= rangeStart || s >= rangeEnd) continue;

    // どの日付列に置くか（開始日基準）
    const dayKey = startOfDay(s).toISOString().slice(0, 10);
    const col = cols.find(c => c.dataset.date === dayKey);
    if (!col) continue;

    const dayStart = startOfDay(s);

    const startMin = clamp(minutesFromDayStart(s, dayStart), 0, 24 * 60);
    const endMin = clamp(minutesFromDayStart(e, dayStart), 0, 24 * 60);

    const top = Math.floor(startMin / minutesPerCell) * cellH + (startMin % minutesPerCell) * (cellH / minutesPerCell);
    const height = Math.max(10, (endMin - startMin) * (cellH / minutesPerCell));

    const block = document.createElement("div");
    block.className = "cal-project";
    block.classList.add(p.status || "draft");
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.textContent = p.title ?? "(無題)";
    block.dataset.projectId = p.id;

    block.addEventListener("click", () => {
      location.href = `/project-edit.html?project_id=${p.id}`;
    });

    col.appendChild(block);
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
  renderProjects(projects, range.start, range.days);
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
  if (newBtn) newBtn.addEventListener("click", () => { location.href = "/project-new.html"; });

  if (datePicker) {
    datePicker.addEventListener("change", () => {
      const v = datePicker.value; // YYYY-MM-DD
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
}

wire();
load().catch(err => showError(err.message));