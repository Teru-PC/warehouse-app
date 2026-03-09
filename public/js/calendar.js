(() => {
  "use strict";

  const TZ = "Asia/Tokyo";
  const DAY_MIN = 1440;
  const SLOT_MIN = 30;
  const GUTTER_PX = 4;
  const COL_W = 120;
  const TIME_W = 72;
  const CELL_H = 28;

  const daysHeader = document.getElementById("daysHeader");
  const timeCol = document.getElementById("timeCol");
  const daysGrid = document.getElementById("daysGrid");
  const errorText = document.getElementById("errorText");
  const navBar = document.getElementById("navBar");
  const dateHeaderBar = document.getElementById("dateHeaderBar");
  const dateHeaderCorner = document.getElementById("dateHeaderCorner");
  const dateHeaderScroll = document.getElementById("dateHeaderScroll");
  const bodyWrap = document.getElementById("mainArea");
  const gridScroll = document.getElementById("gridScroll");

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
    return Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - 9 * 60 * 60 * 1000;
  }

  function addJstDays(dayKey, deltaDays) {
    const ms = jstMidnightUtcMs(dayKey) + deltaDays * 86400000;
    return jstDayKeyFromUtcMs(ms);
  }

  function weekdayIndexInJstFromDayKey(dayKey) {
    const [y, mo, d] = dayKey.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0)).getUTCDay();
  }

  function startOfWeekMonday(dayKey) {
    const w = weekdayIndexInJstFromDayKey(dayKey);
    return addJstDays(dayKey, w === 0 ? -6 : 1 - w);
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

  function jstHmFromUtcDate(d) {
    const p = partsFromDateInJst(d, true);
    return { hh: p.hh, mm: p.mm };
  }

  function minutesFromJstHm(hh, mm) { return hh * 60 + mm; }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function adjustLayout() {
    const navH = navBar ? navBar.getBoundingClientRect().height : 0;
    const headerH = dateHeaderBar ? dateHeaderBar.getBoundingClientRect().height : 0;
    if (dateHeaderBar) dateHeaderBar.style.top = navH + "px";
    if (bodyWrap) {
      bodyWrap.style.marginTop = (navH + headerH) + "px";
      bodyWrap.style.height = `calc(100vh - ${navH + headerH}px)`;
    }
    if (gridScroll) {
      gridScroll.style.height = `calc(100vh - ${navH + headerH}px)`;
      gridScroll.style.paddingTop = "0px";
      gridScroll.scrollTop = Math.max(0, gridScroll.scrollTop);
    }
    if (dateHeaderCorner) dateHeaderCorner.style.width = TIME_W + "px";
    if (timeCol) timeCol.style.width = TIME_W + "px";
  }

  function buildTimeCol(days) {
    clearChildren(timeCol);
    timeCol.style.width = TIME_W + "px";
    for (let m = 0; m < DAY_MIN; m += SLOT_MIN) {
      const slot = document.createElement("div");
      slot.className = "cal-time-slot";
      slot.style.height = CELL_H + "px";
      if (m % 60 === 0) {
        slot.classList.add("is-hour");
        slot.textContent = `${pad2(Math.floor(m / 60))}:00`;
      }
      timeCol.appendChild(slot);
    }
  }

  function buildDaysHeader(days) {
    clearChildren(daysHeader);
    const colW = Math.max(COL_W, Math.floor((window.innerWidth - TIME_W) / days.length));
    daysHeader.style.gridAutoColumns = colW + "px";
    for (const dayKey of days) {
      const [y, mo, d] = dayKey.split("-").map(Number);
      const w = weekdayIndexInJstFromDayKey(dayKey);
      const wd = ["日", "月", "火", "水", "木", "金", "土"][w];
      const head = document.createElement("div");
      head.className = "cal-day-head";
      head.dataset.day = dayKey;
      head.style.minWidth = colW + "px";
      if (w === 6) head.classList.add("is-sat");
      if (w === 0) head.classList.add("is-sun");
      const label = document.createElement("div");
      label.textContent = `${mo}/${d}(${wd})`;
      head.appendChild(label);
      const btnArea = document.createElement("div");
      btnArea.className = "cal-ship-btn-area";
      btnArea.dataset.dayBtns = dayKey;
      head.appendChild(btnArea);
      daysHeader.appendChild(head);
    }
  }

  function buildDaysGrid(days) {
    clearChildren(daysGrid);
    const colW = Math.max(COL_W, Math.floor((window.innerWidth - TIME_W) / days.length));
    daysGrid.style.gridAutoColumns = colW + "px";
    for (const dayKey of days) {
      const col = document.createElement("div");
      col.className = "cal-day-col";
      col.dataset.day = dayKey;
      col.style.minWidth = colW + "px";
      col.style.minHeight = (CELL_H * 48) + "px";
      const w = weekdayIndexInJstFromDayKey(dayKey);
      if (w === 6) col.classList.add("is-sat");
      if (w === 0) col.classList.add("is-sun");
      for (let m = 0; m < DAY_MIN; m += SLOT_MIN) {
        const line = document.createElement("div");
        line.className = "cal-slot-line";
        line.style.height = CELL_H + "px";
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
    const res = await fetch("/api/projects", {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error((json && (json.error || json.message)) || `HTTP ${res.status}`);
    return Array.isArray(json) ? json : (json && json.value) ? json.value : (json && json.projects) ? json.projects : [];
  }

  async function fetchShortages(days) {
    try {
      const from = new Date(jstMidnightUtcMs(days[0])).toISOString();
      const to = new Date(jstMidnightUtcMs(days[days.length - 1]) + 86400000).toISOString();
      const res = await fetch(`/api/shortages?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { Accept: "application/json" } });
      if (!res.ok) return new Map();
      const json = await res.json();
      const map = new Map();
      for (const s of (json.projects || [])) map.set(s.project_id, s.shortage);
      return map;
    } catch { return new Map(); }
  }

  function layoutOverlaps(segs) {
    const active = [], result = [];
    let cluster = [], clusterMaxEnd = -1;
    function flushCluster() {
      if (!cluster.length) return;
      let colCount = 1;
      for (const r of cluster) colCount = Math.max(colCount, r.colIndex + 1);
      for (const r of cluster) r.colCount = colCount;
      cluster = []; clusterMaxEnd = -1;
    }
    for (const s of segs) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].endMin <= s.startMin) active.splice(i, 1);
      }
      const used = new Set(active.map(a => a.colIndex));
      let colIndex = 0;
      while (used.has(colIndex)) colIndex++;
      const placed = { ...s, colIndex, colCount: 1 };
      active.push({ endMin: s.endMin, colIndex });
      if (!cluster.length) {
        clusterMaxEnd = s.endMin;
      } else {
        if (s.startMin >= clusterMaxEnd) { flushCluster(); clusterMaxEnd = s.endMin; }
        else clusterMaxEnd = Math.max(clusterMaxEnd, s.endMin);
      }
      cluster.push(placed);
      result.push(placed);
    }
    flushCluster();
    return result;
  }

  function lightenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `rgb(${r},${g},${b})`;
  }

  function renderAllDayProjects(projects, visibleDays) {
    document.querySelectorAll(".cal-allday-item").forEach(el => el.remove());
    for (const p of projects) {
      if (!p.is_all_day) continue;
      const startIso = p.usage_start_at || p.usage_start;
      if (!startIso) continue;
      const startDayKey = jstDayKeyFromUtcMs(new Date(startIso).getTime());
      const btnArea = document.querySelector(`.cal-ship-btn-area[data-day-btns="${startDayKey}"]`);
      if (!btnArea) continue;
      const btn = document.createElement('div');
      btn.className = 'cal-allday-item';
      if (p.color) {
        btn.style.background = lightenColor(p.color, 60);
        btn.style.borderColor = p.color;
        btn.style.borderWidth = '2px';
        btn.style.borderStyle = 'solid';
        btn.style.color = '#333';
      }
      btn.style.width = '100%';
      btn.style.overflow = 'hidden';
      btn.style.textOverflow = 'ellipsis';
      btn.style.whiteSpace = 'nowrap';
      btn.style.boxSizing = 'border-box';
      btn.textContent = p.title || '(無題)';
      btn.addEventListener('click', ev => {
        ev.preventDefault(); ev.stopPropagation();
        const ret = encodeURIComponent(location.pathname + location.search);
        location.href = `/project-edit.html?id=${p.id}&return=${ret}`;
      });
      btnArea.appendChild(btn);
    }
  }

  function renderProjects(projects, visibleDays, shortageMap = new Map()) {
    document.querySelectorAll(".cal-project").forEach(el => el.remove());
    const visibleSet = new Set(visibleDays);
    const segmentsByDay = new Map();

    for (const p of projects) {
      if (p.is_all_day) continue;
      const startIso = p.usage_start_at || p.usage_start;
      const endIso = p.usage_end_at || p.usage_end;
      if (!startIso || !endIso) continue;
      const startUtc = new Date(startIso);
      const endUtc = new Date(endIso);
      if (isNaN(startUtc.getTime()) || isNaN(endUtc.getTime())) continue;
      const startDayKey = jstDayKeyFromUtcMs(startUtc.getTime());
      const endDayKey = jstDayKeyFromUtcMs(endUtc.getTime());
      const startHm = jstHmFromUtcDate(startUtc);
      const endHm = jstHmFromUtcDate(endUtc);
      let startMin = minutesFromJstHm(startHm.hh, startHm.mm);
      let endMin = minutesFromJstHm(endHm.hh, endHm.mm);
      if (startDayKey === endDayKey && endMin <= startMin) endMin = clamp(startMin + SLOT_MIN, 0, DAY_MIN);

      let dayKey = startDayKey;
      while (true) {
        const isFirst = dayKey === startDayKey, isLast = dayKey === endDayKey;
        if (visibleSet.has(dayKey)) {
          const seg = {
            id: p.id, title: p.title || "(no title)", status: p.status || "draft",
            shortage: shortageMap.has(p.id) ? shortageMap.get(p.id) : Boolean(p.shortage),
            dayKey, color_key: p.color_key || null, color: p.color || null, textColor: '#ffffff',
            startMin: clamp(isFirst ? startMin : 0, 0, DAY_MIN),
            endMin: clamp(isLast ? endMin : DAY_MIN, 0, DAY_MIN),
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
      const segs = (segmentsByDay.get(dayKey) || []).slice()
        .sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin) || (a.id - b.id));
      for (const s of layoutOverlaps(segs)) {
        const el = document.createElement("div");
        el.className = `cal-project ${s.status}`;
        if (s.shortage) el.classList.add("cal-project--shortage");
        if (s.color) {
          el.style.border = `2px solid ${s.color}`;
          el.style.background = lightenColor(s.color, 60);
          el.style.color = '#333333';
        } else if (s.color_key) {
          el.classList.add(`cal-color--${s.color_key}`);
        }
        el.style.color = '#333333';
        el.style.textShadow = '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff';
        el.textContent = s.title;
        el.style.top = `${(s.startMin / DAY_MIN) * 100}%`;
        el.style.height = `${((s.endMin - s.startMin) / DAY_MIN) * 100}%`;
        el.style.left = `calc(${s.colIndex * 16}px + ${GUTTER_PX}px)`;
        el.style.width = `calc(100% - ${s.colIndex * 16}px - ${GUTTER_PX * 2}px)`;
        el.dataset.id = s.id;
        el.addEventListener("click", ev => {
          if (suppressNextClick) { suppressNextClick = false; ev.preventDefault(); ev.stopPropagation(); return; }
          ev.preventDefault(); ev.stopPropagation();
          const ret = encodeURIComponent(location.pathname + location.search);
          location.href = `/project-edit.html?id=${s.id}&return=${ret}`;
        });
        col.appendChild(el);
      }
    }
  }

  function renderShipBtns(projects) {
    document.querySelectorAll('.cal-ship-btn-area').forEach(a => a.innerHTML = '');
    for (const p of projects) {
      if (!p.shipping_date) continue;
      const shipDayKey = p.shipping_date.slice(0, 10);
      const btnArea = document.querySelector(`.cal-ship-btn-area[data-day-btns="${shipDayKey}"]`);
      if (!btnArea) continue;
      const startParts = partsFromDateInJst(new Date(p.usage_start_at || p.usage_start), false);
      const btn = document.createElement('button');
      btn.className = 'cal-ship-btn';
      btn.textContent = `【発送】${p.title || ''} ${startParts.mo}/${startParts.d}`;
      btn.addEventListener('click', ev => {
        ev.preventDefault(); ev.stopPropagation();
        const ret = encodeURIComponent(location.pathname + location.search);
        location.href = `/checklist.html?project_id=${p.id}&return=${ret}`;
      });
      btnArea.appendChild(btn);
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

      adjustLayout();
      buildTimeCol(days);
      buildDaysHeader(days);
      buildDaysGrid(days);

      requestAnimationFrame(() => {
        adjustLayout();

        // 横スクロール同期
        gridScroll.addEventListener("scroll", () => {
          dateHeaderScroll.scrollLeft = gridScroll.scrollLeft;
          timeCol.scrollTop = gridScroll.scrollTop;
        });

        // ドラッグでスクロール（案件ブロック長押し含む）
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragScrollLeft = 0;
        let dragScrollTop = 0;
        let dragMoved = false;
        let longPressTimer = null;
        let pendingProjectClick = null;

        // 文字選択を無効化
        gridScroll.style.userSelect = 'none';
        let suppressNextClick = false;

        gridScroll.addEventListener('mousedown', ev => {
          if (ev.button !== 0) return;
          const projectEl = ev.target.closest('.cal-project');

          dragStartX = ev.clientX;
          dragStartY = ev.clientY;
          dragScrollLeft = gridScroll.scrollLeft;
          dragScrollTop = gridScroll.scrollTop;
          dragMoved = false;

          if (projectEl) {
            // 案件ブロック：300ms長押しでスクロールモードに
            pendingProjectClick = projectEl;
            longPressTimer = setTimeout(() => {
              isDragging = true;
              pendingProjectClick = null;
              gridScroll.style.cursor = 'grabbing';
            }, 300);
          } else {
            isDragging = true;
            gridScroll.style.cursor = 'grabbing';
            ev.preventDefault();
          }
        });

        document.addEventListener('mousemove', ev => {
          const dx = ev.clientX - dragStartX;
          const dy = ev.clientY - dragStartY;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;

          if (!isDragging) {
            // 案件ブロック上でも少し動いたらスクロールモードに切り替え
            if (pendingProjectClick && dragMoved) {
              clearTimeout(longPressTimer);
              isDragging = true;
              pendingProjectClick = null;
              gridScroll.style.cursor = 'grabbing';
            }
            return;
          }
          gridScroll.scrollLeft = dragScrollLeft - dx;
          gridScroll.scrollTop  = dragScrollTop  - dy;
        });

        document.addEventListener('mouseup', ev => {
          clearTimeout(longPressTimer);
          gridScroll.style.cursor = '';

          if (pendingProjectClick && !dragMoved) {
            // クリック（スクロールなし）のみ編集ページへ
            const projectEl = pendingProjectClick;
            pendingProjectClick = null;
            isDragging = false;
            const id = projectEl.dataset && projectEl.dataset.id
              ? projectEl.dataset.id
              : projectEl.closest('[data-id]') && projectEl.closest('[data-id]').dataset.id;
            if (id) {
              const ret = encodeURIComponent(location.pathname + location.search);
              location.href = `/project-edit.html?id=${id}&return=${ret}`;
            }
          } else if (dragMoved) {
            // スクロールした場合はclickイベントを抑制
            suppressNextClick = true;
            pendingProjectClick = null;
          }

          pendingProjectClick = null;
          isDragging = false;
          dragMoved = false;
        });
      });

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

      const [projects, shortageMap] = await Promise.all([fetchProjects(), fetchShortages(days)]);
      renderProjects(projects, days, shortageMap);
      renderShipBtns(projects);
      renderAllDayProjects(projects, days);

      // 終日エリア高さ調整後にlayout再計算
      requestAnimationFrame(() => { adjustLayout(); });

      // 7:00にスクロール
      gridScroll.scrollTop = CELL_H * 14;

    } catch (e) {
      console.error(e);
      showError(String(e.message || e));
    }
  }

  main();
})();