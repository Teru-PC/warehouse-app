(() => {
  "use strict";

  const TZ = "Asia/Tokyo";
  const DAY_MIN = 1440;
  const SLOT_MIN = 30;
  const GUTTER_PX = 4;

  const daysHeader = document.getElementById("daysHeader");
  const timeCol = document.getElementById("timeCol");
  const daysGrid = document.getElementById("daysGrid");
  const errorText = document.getElementById("errorText");

  const modeBtns = {
    day: document.getElementById("modeDay"),
    week: document.getElementById("modeWeek"),
    "2week": document.getElementById("mode2Week"),
    month: document.getElementById("modeMonth"),
  };

  const datePicker = document.getElementById("datePicker");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const newBtn = document.getElementById("newBtn");

  if (!daysHeader || !timeCol || !daysGrid) {
    console.error("[calendar.js] required containers not found");
    return;
  }

  function showError(msg) {
    if (errorText) errorText.textContent = msg || "";
  }

  const qp = new URLSearchParams(location.search);
  const mode = (qp.get("mode") || "week").toLowerCase();
  const baseDateStr = qp.get("date");

  const dtfYMD = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });

  const dtfYMDHM = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  function partsFromDateInJst(dateObj, withTime) {
    const parts = (withTime ? dtfYMDHM : dtfYMD).formatToParts(dateObj);
    const m = Object.create(null);
    for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
    return {
      y: Number(m.year), mo: Number(m.month), d: Number(m.day),
      hh: withTime ? Number(m.hour) : 0, mm: withTime ? Number(m.minute) : 0,
    };
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function toDayKey(y, mo, d) { return `${y}-${pad2(mo)}-${pad2(d)}`; }

  function jstDayKeyFromUtcMs(utcMs) {
    const p = partsFromDateInJst(new Date(utcMs), false);
    return toDayKey(p.y, p.mo, p.d);
  }

  function jstTodayKey() { return jstDayKeyFromUtcMs(Date.now()); }

  function jstMidnightUtcMs(dayKey) {
    const [y, mo, d] = dayKey.split("-").map(Number);
    return Date.UTC(y, mo - 1, d, -9, 0, 0, 0);
  }

  function addJstDays(dayKey, deltaDays) {
    const ms = jstMidnightUtcMs(dayKey) + deltaDays * 86400000;
    return jstDayKeyFromUtcMs(ms);
  }

  function weekdayIndexInJstFromDayKey(dayKey) {
    return new Date(jstMidnightUtcMs(dayKey)).getUTCDay();
  }

  function startOfWeekMonday(dayKey) {
    const w = weekdayIndexInJstFromDayKey(dayKey);
    const diff = (w === 0 ? -6 : 1 - w);
    return addJstDays(dayKey, diff);
  }

  function getRangeDays(modeName, baseKey) {
    if (modeName === "day") return [baseKey];
    const startKey = startOfWeekMonday(baseKey);
    if (modeName === "2week" || modeName === "2weeks") {
      return Array.from({ length: 14 }, (_, i) => addJstDays(startKey, i));
    }
    if (modeName === "month") {
      const [y, mo] = baseKey.split("-").map(Number);
      const first = `${y}-${pad2(mo)}-01`;
      const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      return Array.from({ length: daysInMonth }, (_, i) => addJstDays(first, i));
    }
    return Array.from({ length: 7 }, (_, i) => addJstDays(startKey, i));
  }

  function jstHmFromUtcDate(dateObjUtc) {
    const p = partsFromDateInJst(dateObjUtc, true);
    return { hh: p.hh, mm: p.mm };
  }

  function minutesFromJstHm(hh, mm) { return hh * 60 + mm; }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function buildTimeCol() {
    clearChildren(timeCol);
    for (let m = 0; m < DAY_MIN; m += SLOT_MIN) {
      const slot = document.createElement("div");
      slot.className = "cal-time-slot";
      if (m % 60 === 0) {
        slot.classList.add("is-hour");
        slot.textContent = `${pad2(Math.floor(m / 60))}:00`;
      }
      timeCol.appendChild(slot);
    }
  }

  function buildDaysHeader(days) {
    clearChildren(daysHeader);
    for (const dayKey of days) {
      const [y, mo, d] = dayKey.split("-").map(Number);
      const w = weekdayIndexInJstFromDayKey(dayKey);
      const wd = ["日", "月", "火", "水", "木", "金", "土"][w];
      const head = document.createElement("div");
      head.className = "cal-day-head";
      if (w === 6) head.classList.add("is-sat");
      if (w === 0) head.classList.add("is-sun");
      head.textContent = `${mo}/${d}(${wd})`;
      daysHeader.appendChild(head);
    }
  }

  function buildDaysGrid(days) {
    clearChildren(daysGrid);
    for (const dayKey of days) {
      const col = document.createElement("div");
      col.className = "cal-day-col";
      col.dataset.day = dayKey;
      const w = weekdayIndexInJstFromDayKey(dayKey);
      if (w === 6) col.classList.add("is-sat");
      if (w === 0) col.classList.add("is-sun");
      for (let m = 0; m < DAY_MIN; m += SLOT_MIN) {
        const line = document.createElement("div");
        line.className = "cal-slot-line";
        if (m % 60 === 0) line.classList.add("hour");
        col.appendChild(line);
      }
      daysGrid.appendChild(col);
    }
  }

  function setActiveModeBtn(m) {
    for (const k of Object.keys(modeBtns)) {
      const b = modeBtns[k];
      if (!b) continue;
      b.classList.toggle("is-active", k === m);
    }
  }

  function navigateTo(newMode, newDateKey) {
    const u = new URL(location.href);
    u.searchParams.set("mode", newMode);
    u.searchParams.set("date", newDateKey);
    location.href = u.pathname + "?" + u.searchParams.toString();
  }

  async function fetchProjects() {
    const token = localStorage.getItem('token') || '';
    const res = await fetch("/api/projects", { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return Array.isArray(json) ? json : (json && json.value) ? json.value : (json && json.projects) ? json.projects : [];
  }

  async function fetchShortages(days) {
    try {
      const from = jstMidnightUtcMs(days[0]);
      const to = jstMidnightUtcMs(days[days.length - 1]) + 86400000;
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      const res = await fetch(
        `/api/shortages?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return new Map();
      const json = await res.json();
      const map = new Map();
      for (const s of (json.projects || [])) {
        map.set(s.project_id, s.shortage);
      }
      return map;
    } catch (e) {
      console.warn("shortage取得失敗:", e);
      return new Map();
    }
  }

  function layoutOverlaps(segs) {
    const active = [];
    const result = [];
    let cluster = [];
    let clusterMaxEnd = -1;

    function flushCluster() {
      if (!cluster.length) return;
      let colCount = 1;
      for (const r of cluster) colCount = Math.max(colCount, r.colIndex + 1);
      for (const r of cluster) r.colCount = colCount;
      cluster = [];
      clusterMaxEnd = -1;
    }

    for (const s of segs) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].endMin <= s.startMin) active.splice(i, 1);
      }
      const used = new Set(active.map((a) => a.colIndex));
      let colIndex = 0;
      while (used.has(colIndex)) colIndex++;
      const placed = { ...s, colIndex, colCount: 1 };
      active.push({ endMin: s.endMin, colIndex });
      if (!cluster.length) {
        clusterMaxEnd = s.endMin;
      } else {
        if (s.startMin >= clusterMaxEnd) {
          flushCluster();
          clusterMaxEnd = s.endMin;
        } else {
          clusterMaxEnd = Math.max(clusterMaxEnd, s.endMin);
        }
      }
      cluster.push(placed);
      result.push(placed);
    }
    flushCluster();
    return result;
  }

  function clearProjectBlocks() {
    document.querySelectorAll(".cal-project").forEach((el) => el.remove());
  }

  function renderProjects(projects, visibleDays, shortageMap = new Map()) {
    clearProjectBlocks();
    const visibleSet = new Set(visibleDays);
    const segmentsByDay = new Map();

    for (const p of projects) {
      const id = p.id;
      const title = p.title || "(no title)";
      const status = p.status || "draft";
      const shortage = shortageMap.has(p.id) ? shortageMap.get(p.id) : Boolean(p.shortage) || Boolean(p.is_shortage);
      const startIso = p.usage_start_at || p.usage_start;
      const endIso = p.usage_end_at || p.usage_end;
      if (!startIso || !endIso) continue;
      const startUtc = new Date(startIso);
      const endUtc = new Date(endIso);
      if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) continue;
      const startDayKey = jstDayKeyFromUtcMs(startUtc.getTime());
      const endDayKey = jstDayKeyFromUtcMs(endUtc.getTime());
      const startHm = jstHmFromUtcDate(startUtc);
      const endHm = jstHmFromUtcDate(endUtc);
      let startMin = minutesFromJstHm(startHm.hh, startHm.mm);
      let endMin = minutesFromJstHm(endHm.hh, endHm.mm);
      if (startDayKey === endDayKey && endMin <= startMin) {
        endMin = clamp(startMin + SLOT_MIN, 0, DAY_MIN);
      }
      let dayKey = startDayKey;
      while (true) {
        const isFirst = dayKey === startDayKey;
        const isLast = dayKey === endDayKey;
        const segStart = isFirst ? startMin : 0;
        const segEnd = isLast ? endMin : DAY_MIN;
        if (visibleSet.has(dayKey)) {
          const seg = {
            id, title, status, shortage, dayKey,
            startMin: clamp(segStart, 0, DAY_MIN),
            endMin: clamp(segEnd, 0, DAY_MIN),
            color_key: p.color_key || null,
          };
          if (seg.endMin > seg.startMin) {
            if (!segmentsByDay.has(dayKey)) segmentsByDay.set(dayKey, []);
            segmentsByDay.get(dayKey).push(seg);
          }
        }
        if (isLast) break;
        dayKey = addJstDays(dayKey, 1);
      }
    }

    for (const dayKey of visibleDays) {
      const col = daysGrid.querySelector(`.cal-day-col[data-day="${dayKey}"]`);
      if (!col) continue;
      const segs = (segmentsByDay.get(dayKey) || [])
        .slice()
        .sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin) || (a.id - b.id));
      const laidOut = layoutOverlaps(segs);
      for (const s of laidOut) {
        const el = document.createElement("div");
        el.className = "cal-project";
        el.classList.add(String(s.status));
        if (s.shortage) el.classList.add("cal-project--shortage");
        if (s.color_key) el.classList.add(`cal-color--${s.color_key}`);
        el.dataset.id = String(s.id);
        el.dataset.day = s.dayKey;
        el.textContent = s.title;
        const topPct = (s.startMin / DAY_MIN) * 100;
        const heightPct = ((s.endMin - s.startMin) / DAY_MIN) * 100;
        const leftPct = (s.colIndex / s.colCount) * 100;
        const widthPct = (1 / s.colCount) * 100;
        el.style.top = `${topPct}%`;
        el.style.height = `${heightPct}%`;
        el.style.left = `calc(${leftPct}% + ${GUTTER_PX}px)`;
        el.style.width = `calc(${widthPct}% - ${GUTTER_PX * 2}px)`;
        el.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const ret = encodeURIComponent(location.pathname + location.search);
          location.href = `/project-edit.html?id=${encodeURIComponent(String(s.id))}&return=${ret}`;
        });
        col.appendChild(el);
      }
    }

    // 発送・返却バー描画
    function makeBar(col, startMin, endMin, text, color) {
      if (endMin <= startMin) return;
      const el = document.createElement('div');
      el.className = 'cal-ship-bar';
      el.textContent = text;
      el.style.cssText = `
        position:absolute;
        top:${(startMin/DAY_MIN)*100}%;
        height:${((endMin-startMin)/DAY_MIN)*100}%;
        left:2px; right:2px;
        background:${color};
        border-radius:4px;
        font-size:10px;
        font-weight:700;
        color:#92400e;
        padding:2px 4px;
        pointer-events:none;
        z-index:0;
        box-sizing:border-box;
        overflow:hidden;
        white-space:nowrap;
        text-overflow:ellipsis;
      `;
      col.appendChild(el);
    }

    const SHIP_COLOR = 'rgba(254,240,138,0.75)'; // 薄い黄色

    for (const p of projects) {
      const startIso = p.usage_start_at || p.usage_start;
      const endIso = p.usage_end_at || p.usage_end;
      const shippingDate = p.shipping_date;
      const returnDueDate = p.return_due_date;
      const title = p.title || '';

      // 発送バー
      if (shippingDate) {
        const shipDayKey = shippingDate.slice(0, 10);
        if (visibleSet.has(shipDayKey)) {
          const col = daysGrid.querySelector(`.cal-day-col[data-day="${shipDayKey}"]`);
          if (col) {
            // 発送日の案件開始時刻を取得（同日の場合）
            let usageStartMin = DAY_MIN;
            if (startIso) {
              const startUtc = new Date(startIso);
              const startHm = jstHmFromUtcDate(startUtc);
              const startDayKey = jstDayKeyFromUtcMs(startUtc.getTime());
              if (startDayKey === shipDayKey) {
                usageStartMin = minutesFromJstHm(startHm.hh, startHm.mm);
              }
            }
            // 0:00 〜 案件開始（または18:00まで）
            makeBar(col, 0, Math.min(usageStartMin, 18 * 60), `発送 ${title}`, SHIP_COLOR);
            // 18:00 〜 24:00
            makeBar(col, 18 * 60, DAY_MIN, `発送 ${title}`, SHIP_COLOR);
          }
        }
      }

      // 返却バー
      if (returnDueDate) {
        const returnDayKey = returnDueDate.slice(0, 10);
        if (visibleSet.has(returnDayKey)) {
          const col = daysGrid.querySelector(`.cal-day-col[data-day="${returnDayKey}"]`);
          if (col) {
            // 返却日の案件終了時刻を取得（同日の場合）
            let usageEndMin = 0;
            if (endIso) {
              const endUtc = new Date(endIso);
              const endHm = jstHmFromUtcDate(endUtc);
              const endDayKey = jstDayKeyFromUtcMs(endUtc.getTime());
              if (endDayKey === returnDayKey) {
                usageEndMin = minutesFromJstHm(endHm.hh, endHm.mm);
              }
            }
            // 0:00 〜 12:00
            makeBar(col, 0, 12 * 60, `返却 ${title}`, SHIP_COLOR);
            // 案件終了（または12:00以降）〜 24:00
            makeBar(col, Math.max(usageEndMin, 12 * 60), DAY_MIN, `返却 ${title}`, SHIP_COLOR);
          }
        }
      }
    }
  }

  function getBaseDayKey() {
    if (baseDateStr && /^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) return baseDateStr;
    return jstTodayKey();
  }

  async function main() {
    try {
      showError("");
      const baseKey = getBaseDayKey();
      const days = getRangeDays(mode, baseKey);
      setActiveModeBtn(mode);
      if (datePicker) datePicker.value = baseKey;
      buildTimeCol();
      buildDaysHeader(days);
      buildDaysGrid(days);
      if (datePicker) {
        datePicker.addEventListener("change", () => {
          const v = datePicker.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) navigateTo(mode, v);
        });
      }
      Object.entries(modeBtns).forEach(([k, btn]) => {
        if (!btn) return;
        btn.addEventListener("click", () => navigateTo(k, baseKey));
      });
      prevBtn && prevBtn.addEventListener("click", () => {
        const step = mode === "day" ? -1 : mode === "2week" ? -14 : mode === "month" ? -30 : -7;
        navigateTo(mode, addJstDays(baseKey, step));
      });
      nextBtn && nextBtn.addEventListener("click", () => {
        const step = mode === "day" ? 1 : mode === "2week" ? 14 : mode === "month" ? 30 : 7;
        navigateTo(mode, addJstDays(baseKey, step));
      });
      newBtn && newBtn.addEventListener("click", () => {
        const ret = encodeURIComponent(location.pathname + location.search);
        location.href = `/project-new.html?return=${ret}`;
      });
      const [projects, shortageMap] = await Promise.all([
        fetchProjects(),
        fetchShortages(days),
      ]);
      renderProjects(projects, days, shortageMap);

      // 7:00の位置にスクロール（上にスクロールで0:00も見られる）
      const slot7 = document.querySelector(".cal-time-slot");
      if (slot7) {
        const slotH7 = slot7.getBoundingClientRect().height || 28;
        window.scrollTo({ top: slotH7 * 14 * 2, behavior: "instant" });
      }
    } catch (e) {
      console.error(e);
      showError(String(e.message || e));
    }
  }

  main();
})();