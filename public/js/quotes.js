(function () {
  const token = window.authUtils ? window.authUtils.getToken() : '';
  if (!token) {
    location.href = '/login.html';
    return;
  }

  // ── 会場常設チェックを表示できる品目パターン ─────────────
  // 常時「常設」チェック済み（venueEquipment）
  const VENUE_EQUIPMENT_PATTERNS = ['無線マイク', '有線マイク', 'スピーカー'];
  // 常設に切り替え可能（venueCheckable・初期は未チェック）
  const VENUE_CHECKABLE_PATTERNS = [
    '同時通訳ブース', '簡易卓上ブース', '音響ミキサー', '通訳ユニット',
  ];
  function isVenueCheckable(name) {
    return VENUE_CHECKABLE_PATTERNS.some(p => (name || '').includes(p));
  }
  function isVenueEquipment(name) {
    return VENUE_EQUIPMENT_PATTERNS.some(p => (name || '').includes(p));
  }

  // ── 旧フォーマット「台/日」→ {qtyUnit,daysVal,daysUnitVal} に変換 ──
  function parseUnitString(unit) {
    const u = (unit || '').trim();
    if (!u || u === '式' || u === '一式' || u === '時間') {
      return { qtyUnit: u || '式', daysVal: 0, daysUnitVal: '' };
    }
    const slash = u.indexOf('/');
    if (slash === -1) return { qtyUnit: u, daysVal: 0, daysUnitVal: '' };
    return {
      qtyUnit:    u.substring(0, slash).trim(),
      daysVal:    1,
      daysUnitVal: u.substring(slash + 1).trim(),
    };
  }

  // ── AI返却データを新フォーマットに変換（numDaysを各品目に適用）──
  function migrateItemUnits(items, numDays) {
    const d = Math.max(1, Number(numDays) || 1);
    return (items || []).map(it => {
      if (!it || it.empty) return it;
      if ('daysUnit' in it) return it;
      const u = (it.unit || '').trim();
      if (!u || u === '式' || u === '一式' || u === '時間') {
        return Object.assign({}, it, { unit: u || '式', days: 0, daysUnit: '' });
      }
      const slash = u.indexOf('/');
      if (slash === -1) return Object.assign({}, it, { unit: u, days: 0, daysUnit: '' });
      const qtyUnit  = u.substring(0, slash).trim();
      const timeUnit = u.substring(slash + 1).trim();
      return Object.assign({}, it, {
        unit:    qtyUnit,
        days:    timeUnit === '日' ? d : 1,
        daysUnit: timeUnit,
      });
    });
  }

  // ── プリセットデータ ──────────────────────────────────────
  const PRESETS = {
    local: {
      name: '現地のみ',
      items: [
        { name: '通訳ユニット',           quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 18000, venueCheckable: true },
        { name: '簡易卓上ブース',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 30000, venueCheckable: true },
        { name: 'FM無線送信機',           quantity: 2, unit: '台', days: 1, daysUnit: '日', unitPrice: 2000 },
        { name: 'FM無線受信機',           quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 1000 },
        { name: '音響ミキサー（小）',     quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 15000, venueCheckable: true },
        { name: '無線マイク',             quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true },
        { name: '有線マイク',             quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true },
        { name: 'スピーカー・音響設備',   quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true },
        { name: 'チーフエンジニア',       quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
        { name: '機材運搬費',             quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { name: '設営・撤去費',           quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { empty: true }, { empty: true },
      ],
    },
    online: {
      name: 'オンライン',
      items: [
        { name: '通訳ユニット',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 18000, venueCheckable: true },
        { name: 'オンライン接続用PC',         quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 7000 },
        { name: 'オーディオインターフェイス', quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 2000 },
        { name: 'モニターセット（通訳者用）', quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 10000 },
        { name: '音響ミキサー（小）',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 15000, venueCheckable: true },
        { name: 'スタジオ使用料',             quantity: 1, unit: '時間', days: 0, daysUnit: '', unitPrice: 10000 },
        { name: 'チーフエンジニア',           quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
        { empty: true }, { empty: true },
      ],
    },
    bridge: {
      name: 'ブリッジ',
      split: true,
      studioItems: [
        { name: '通訳ユニット',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 18000, venueCheckable: true },
        { name: 'オンライン接続用PC',         quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 7000 },
        { name: 'オーディオインターフェイス', quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 2000 },
        { name: 'モニターセット（通訳者用）', quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 10000 },
        { name: '音響ミキサー（小）',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 15000, venueCheckable: true },
        { name: 'スタジオ使用料',             quantity: 1, unit: '時間', days: 0, daysUnit: '', unitPrice: 10000 },
        { name: 'チーフエンジニア',           quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
      ],
      localItems: [
        { name: 'オンライン接続用PC',         quantity: 2, unit: '台', days: 1, daysUnit: '日', unitPrice: 7000 },
        { name: '音響ミキサー（小）',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 15000, venueCheckable: true },
        { name: 'FM無線送信機',               quantity: 2, unit: '台', days: 1, daysUnit: '日', unitPrice: 2000 },
        { name: 'FM無線受信機',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 1000 },
        { name: 'チーフエンジニア',           quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
        { name: '機材運搬費',                 quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { name: '設営・撤去費',               quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { empty: true }, { empty: true },
      ],
    },
    localStream: {
      name: '現地配信あり',
      split: true,
      studioItems: [
        { name: '通訳ユニット',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 18000, venueCheckable: true },
        { name: 'オンライン接続用PC',         quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 7000 },
        { name: 'オーディオインターフェイス', quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 2000 },
        { name: 'モニターセット（通訳者用）', quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 10000 },
        { name: '音響ミキサー（小）',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 15000, venueCheckable: true },
        { name: 'スタジオ使用料',             quantity: 1, unit: '時間', days: 0, daysUnit: '', unitPrice: 10000 },
        { name: 'チーフエンジニア',           quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
      ],
      localItems: [
        { name: 'オンライン接続用PC',         quantity: 3, unit: '台', days: 1, daysUnit: '日', unitPrice: 7000 },
        { name: '音響ミキサー（小）',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 15000, venueCheckable: true },
        { name: 'FM無線送信機',               quantity: 2, unit: '台', days: 1, daysUnit: '日', unitPrice: 2000 },
        { name: 'FM無線受信機',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 1000 },
        { name: 'ビデオカメラ',               quantity: 2, unit: '台', days: 1, daysUnit: '日', unitPrice: 25000 },
        { name: '映像スイッチャー',           quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 25000 },
        { name: 'カメラ備品',                 quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 5000 },
        { name: 'モニター（カメラ用）',       quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 10000 },
        { name: 'チーフエンジニア',           quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
        { name: 'アシスタントエンジニア',     quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 30000 },
        { name: '機材運搬費',                 quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { name: '設営・撤去費',               quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { empty: true }, { empty: true },
      ],
    },
    ram: {
      name: 'ラムに依頼',
      items: [
        { name: '通訳ユニット',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 18000, venueCheckable: true },
        { name: '同時通訳ブース',             quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 0,     venueCheckable: true },
        { name: '赤外線送信機＋ラジエター',   quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0 },
        { name: '赤外線受信機',               quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 0 },
        { name: '音響ミキサー（大）',         quantity: 1, unit: '台', days: 1, daysUnit: '日', unitPrice: 0,     venueCheckable: true },
        { name: '無線マイク',                 quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true },
        { name: '有線マイク',                 quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true },
        { name: 'スピーカー・音響設備',       quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true },
        { name: 'チーフエンジニア',           quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 35000 },
        { name: 'アシスタントエンジニア',     quantity: 1, unit: '名', days: 1, daysUnit: '日', unitPrice: 30000 },
        { name: '機材運搬費',                 quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { name: '設営・撤去費',               quantity: 1, unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 },
        { empty: true }, { empty: true },
      ],
    },
  };

  // ── 通訳品目：旅費系はPDFで自動生成のため除外 ────────────
  const TRAVEL_ITEM_NAMES = ['移動拘束費', '日当', '交通費', '宿泊費', '旅費', '延長料'];
  function filterInterpItems(items) {
    return (items || []).filter(it => !TRAVEL_ITEM_NAMES.some(n => it.name.includes(n)));
  }

  // ── 通訳料の単価を言語に応じて設定 ──────────────────────
  function applyInterpPricing(items, languages) {
    const isEnglish = (languages || []).some(l => /英/.test(l));
    const halfDayPrice = isEnglish ? 62000 : 65000;
    const fullDayPrice = isEnglish ? 95000 : 99000;
    return (items || []).map(it => {
      const name = it.name || '';
      let price = Number(it.unitPrice) || 0;
      if (/半日/.test(name)) price = halfDayPrice;
      else if (/1日|一日/.test(name)) price = fullDayPrice;
      const qty = Number(it.quantity) || 0;
      const d   = Number(it.days) > 0 ? Number(it.days) : 1;
      const sub = it.venueEquipment ? 0 : qty * d * price;
      return Object.assign({}, it, { unitPrice: price, subtotal: sub });
    });
  }

  // ── AI生成機材品目に venue フラグを付与 ──────────────────
  function markVenueCheckable(items) {
    return (items || []).map(it => {
      const name = it.name || '';
      if (!it.venueEquipment && isVenueEquipment(name)) {
        return Object.assign({}, it, { venueEquipment: true });
      }
      if (!it.venueEquipment && !it.venueCheckable && isVenueCheckable(name)) {
        return Object.assign({}, it, { venueCheckable: true });
      }
      return it;
    });
  }

  // ── AI生成機材品目を正規化（フィルタ・名称統一）────────────
  const EQUIP_FILTER_NAMES = ['スピーカー（小型）', 'アシスタントエンジニア'];
  function normalizeEquipItems(items) {
    return (items || [])
      .filter(it => !EQUIP_FILTER_NAMES.some(f => (it.name || '').includes(f)))
      .map(it => {
        let name = it.name || '';
        if (name.includes('同時通訳ブース')) name = name.replace('同時通訳ブース', '簡易卓上ブース');
        return name === it.name ? it : Object.assign({}, it, { name });
      });
  }

  // ── 機材品目の重複除去（同名は単価の高い方を残す）────────
  function deduplicateEquipItems(items) {
    const seen = new Map();
    const result = [];
    (items || []).forEach(item => {
      if (item.empty) { result.push(item); return; }
      const name = (item.name || '').trim();
      if (!name) { result.push(item); return; }
      if (!seen.has(name)) {
        seen.set(name, result.length);
        result.push(item);
      } else {
        const idx = seen.get(name);
        if ((Number(item.unitPrice) || 0) > (Number(result[idx].unitPrice) || 0)) {
          result[idx] = item;
        }
      }
    });
    return result;
  }

  // ── ファイル名生成 ─────────────────────────────────────────
  function buildFileName(d) {
    const unsafe   = /[/\\:*?"<>|]/g;
    const customer = (d.customerName || '').replace(unsafe, '_');
    const date     = (d.eventDate    || '').replace(unsafe, '_');
    const project  = (d.projectName  || '').replace(unsafe, '_');
    return `【御見積書】${customer}御中_${date}_${project}`;
  }

  // ── 価格マスタをフェッチしてオートコンプリート用datalistを作成 ──
  let priceMasterData = null;
  fetch('/api/quotes/price-master', { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return;
      priceMasterData = data;
      const names = [
        ...(data.interpretation || []).map(i => i.name),
        ...(data.equipment || []).map(i => i.name),
      ];
      const dl = document.createElement('datalist');
      dl.id = 'itemNameList';
      names.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        dl.appendChild(opt);
      });
      document.body.appendChild(dl);
    })
    .catch(() => {});

  // ── DOM refs ──────────────────────────────────────────────
  const emailTextEl   = document.getElementById('emailText');
  const generateBtn   = document.getElementById('generateBtn');
  const loading       = document.getElementById('loading');
  const errorArea     = document.getElementById('errorArea');
  const previewArea   = document.getElementById('previewArea');

  const fType         = document.getElementById('fType');
  const fCustomer     = document.getElementById('fCustomer');
  const fProject      = document.getElementById('fProject');
  const fDate         = document.getElementById('fDate');
  const fLocation     = document.getElementById('fLocation');
  const fSetup        = document.getElementById('fSetup');
  const fTeardown     = document.getElementById('fTeardown');

  const interpCard    = document.getElementById('interpCard');
  const interpBody    = document.getElementById('interpBody');
  const addInterpBtn  = document.getElementById('addInterpBtn');

  const equipCard     = document.getElementById('equipCard');
  const equipBody     = document.getElementById('equipBody');
  const addEquipBtn   = document.getElementById('addEquipBtn');
  const equipSingle   = document.getElementById('equipSingle');
  const equipSplit    = document.getElementById('equipSplit');
  const studioBody    = document.getElementById('studioBody');
  const localBody     = document.getElementById('localBody');
  const addStudioBtn  = document.getElementById('addStudioBtn');
  const addLocalBtn   = document.getElementById('addLocalBtn');

  const totalAmountEl = document.getElementById('totalAmount');
  const pdfBtn        = document.getElementById('pdfBtn');
  const downloadBtn   = document.getElementById('downloadBtn');

  // ── 状態 ─────────────────────────────────────────────────
  let quoteData   = null;
  let isSplitMode = false;

  // ── 機材品目の表示モード切替 ──────────────────────────────
  function setEquipMode(split) {
    isSplitMode = split;
    equipSingle.style.display = split ? 'none' : '';
    equipSplit.style.display  = split ? '' : 'none';
  }

  // ── ユーティリティ ───────────────────────────────────────
  function showError(msg) {
    errorArea.innerHTML = `<div class="err">${msg}</div>`;
    errorArea.style.display = 'block';
  }
  function clearError() {
    errorArea.style.display = 'none';
    errorArea.innerHTML = '';
  }
  function fmt(n) {
    return '¥' + (Number(n) || 0).toLocaleString('ja-JP');
  }
  function calcSubtotal(qty, price, days) {
    const d = Number(days);
    return (Number(qty) || 0) * (d > 0 ? d : 1) * (Number(price) || 0);
  }
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];
  function addDayOfWeek(dateStr) {
    if (!dateStr || /日（[月火水木金土日]）/.test(dateStr)) return dateStr;
    return dateStr.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/, function(_, y, m, d) {
      const dow = DOW_JP[new Date(Number(y), Number(m) - 1, Number(d)).getDay()];
      return y + '年' + m + '月' + d + '日（' + dow + '）';
    });
  }

  // ── typeに応じてカード表示切替 ────────────────────────────
  function updateCardVisibility() {
    const t = fType.value;
    if (t === 'interpretation' || t === 'english') {
      interpCard.style.display = '';
      equipCard.style.display  = 'none';
    } else if (t === 'equipment') {
      interpCard.style.display = 'none';
      equipCard.style.display  = '';
    } else {
      interpCard.style.display = '';
      equipCard.style.display  = '';
    }
    recalcTotal();
  }
  fType.addEventListener('change', updateCardVisibility);

  // ── ドラッグ&ドロップ ─────────────────────────────────────
  function initDragDrop(tbody) {
    let dragSrc  = null;
    let touchSrc = null;

    tbody.addEventListener('dragstart', e => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) { e.preventDefault(); return; }
      dragSrc = handle.closest('tr');
      dragSrc.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    tbody.addEventListener('dragover', e => {
      if (!dragSrc) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('tr');
      if (!target || target === dragSrc || !tbody.contains(target)) return;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      target.classList.add('drag-over');
    });
    tbody.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      }
    });
    tbody.addEventListener('drop', e => {
      e.preventDefault();
      const target = e.target.closest('tr');
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (!target || target === dragSrc || !tbody.contains(target)) return;
      const rows = [...tbody.querySelectorAll('tr')];
      const srcIdx = rows.indexOf(dragSrc);
      const tgtIdx = rows.indexOf(target);
      if (srcIdx < tgtIdx) target.after(dragSrc);
      else target.before(dragSrc);
    });
    tbody.addEventListener('dragend', () => {
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
      dragSrc = null;
    });
    tbody.addEventListener('touchstart', e => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      touchSrc = handle.closest('tr');
      touchSrc.classList.add('dragging');
      e.preventDefault();
    }, { passive: false });
    tbody.addEventListener('touchmove', e => {
      if (!touchSrc) return;
      e.preventDefault();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const target = el ? el.closest('tr') : null;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (target && target !== touchSrc && tbody.contains(target)) target.classList.add('drag-over');
    }, { passive: false });
    tbody.addEventListener('touchend', e => {
      if (!touchSrc) return;
      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const target = el ? el.closest('tr') : null;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
      if (target && target !== touchSrc && tbody.contains(target)) {
        const rows = [...tbody.querySelectorAll('tr')];
        const srcIdx = rows.indexOf(touchSrc);
        const tgtIdx = rows.indexOf(target);
        if (srcIdx < tgtIdx) target.after(touchSrc);
        else target.before(touchSrc);
      }
      touchSrc = null;
    });
  }

  // ── 品目行を追加 ──────────────────────────────────────────
  function addItemRow(tbody, item, isEquip, insertBefore) {
    item = item || { name: '', quantity: 1, unit: '式', days: 0, daysUnit: '', unitPrice: 0 };

    // 単位フィールドを分解（旧フォーマット「台/日」→新フォーマット）
    let qtyUnit, daysVal, daysUnitVal;
    if ('daysUnit' in item) {
      qtyUnit    = item.unit     || '式';
      daysVal    = item.days    != null ? item.days    : 0;
      daysUnitVal = item.daysUnit != null ? item.daysUnit : '';
    } else {
      const p    = parseUnitString(item.unit || '式');
      qtyUnit    = p.qtyUnit;
      daysVal    = p.daysVal;
      daysUnitVal = p.daysUnitVal;
    }

    const isVenue        = isEquip && Boolean(item.venueEquipment);
    const showVenueCheck = isEquip && (Boolean(item.venueEquipment) || Boolean(item.venueCheckable));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-drag"><span class="drag-handle" draggable="true" title="ドラッグして並び替え">⠿</span></td>
      <td class="td-name"><input type="text" class="name-input" value="${esc(item.name)}" placeholder="品名" list="itemNameList" /></td>
      <td>
        ${showVenueCheck ? `<label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px;white-space:nowrap;"><input type="checkbox" class="venue-check" ${isVenue ? 'checked' : ''}>常設</label>` : ''}
        <div class="qty-cell" style="display:${isVenue ? 'none' : 'flex'};align-items:center;gap:2px;">
          <input type="number" class="qty-input" value="${Number(item.quantity) || 1}" min="0" style="width:44px;" />
          <input type="text" class="unit-input" value="${esc(qtyUnit)}" style="width:28px;text-align:center;" />
        </div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:2px;">
          <input type="number" class="days-input" value="${daysVal > 0 ? daysVal : ''}" min="0" step="0.5" style="width:34px;" placeholder="" />
          <input type="text" class="days-unit-input" value="${esc(daysUnitVal)}" style="width:26px;text-align:center;" />
        </div>
      </td>
      <td><input type="number" class="price-input" value="${Number(item.unitPrice) || 0}" min="0" step="100" /></td>
      <td class="td-sub">${isVenue ? fmt(0) : fmt(calcSubtotal(item.quantity, item.unitPrice, daysVal))}</td>
      <td class="td-del"><button class="del-btn" type="button" title="削除">×</button></td>
    `;
    const nameIn     = tr.querySelector('.name-input');
    const unitIn     = tr.querySelector('.unit-input');
    const qtyIn      = tr.querySelector('.qty-input');
    const daysIn     = tr.querySelector('.days-input');
    const daysUnitIn = tr.querySelector('.days-unit-input');
    const priceIn    = tr.querySelector('.price-input');
    function updateSub() {
      const venueChk = tr.querySelector('.venue-check');
      if (venueChk && venueChk.checked) {
        tr.querySelector('.td-sub').textContent = fmt(0);
      } else {
        const days = daysIn ? Number(daysIn.value) || 0 : 0;
        tr.querySelector('.td-sub').textContent = fmt(calcSubtotal(qtyIn.value, priceIn.value, days));
      }
      recalcTotal();
    }
    if (showVenueCheck) {
      const venueChk = tr.querySelector('.venue-check');
      venueChk.addEventListener('change', () => {
        const qtyCell = tr.querySelector('.qty-cell');
        if (qtyCell) qtyCell.style.display = venueChk.checked ? 'none' : 'flex';
        updateSub();
      });
    }
    qtyIn.addEventListener('input', updateSub);
    daysIn.addEventListener('input', updateSub);
    priceIn.addEventListener('input', updateSub);
    nameIn.addEventListener('change', () => {
      if (!priceMasterData) return;
      const allMaster = [...(priceMasterData.interpretation || []), ...(priceMasterData.equipment || [])];
      const match = allMaster.find(m => m.name === nameIn.value);
      if (match) {
        priceIn.value = match.unitPrice;
        const parsed = parseUnitString(match.unit || '式');
        unitIn.value     = parsed.qtyUnit;
        daysIn.value     = parsed.daysVal > 0 ? parsed.daysVal : '';
        daysUnitIn.value = parsed.daysUnitVal;
        updateSub();
      }
    });
    tr.querySelector('.del-btn').addEventListener('click', () => { tr.remove(); recalcTotal(); });
    if (insertBefore) tbody.insertBefore(tr, insertBefore);
    else tbody.appendChild(tr);
  }

  // ── 空行を追加 ────────────────────────────────────────────
  function addEmptyRow(tbody) {
    const tr = document.createElement('tr');
    tr.style.height = '22px';
    tr.innerHTML = '<td class="td-drag"></td><td colspan="5"></td><td></td>';
    tbody.appendChild(tr);
  }

  // ── 管理費行を追加（通訳テーブル末尾）──────────────────────
  function addMgmtFeeRow(tbody) {
    const tr = document.createElement('tr');
    tr.className = 'mgmt-fee-row';
    tr.style.background = '#f9fafb';
    tr.innerHTML =
      '<td class="td-drag"></td>' +
      '<td class="td-name" style="font-weight:600;color:#374151;">管理費</td>' +
      '<td></td>' +
      '<td colspan="2" style="text-align:center;font-size:11px;color:#9ca3af;font-style:italic;padding:5px 8px;">上記通訳料合計の10%</td>' +
      '<td class="td-sub" style="color:#374151;"></td>' +
      '<td></td>';
    tbody.appendChild(tr);
  }

  // ── テーブルを描画 ────────────────────────────────────────
  function renderTable(tbody, items, isEquip, opts) {
    opts = opts || {};
    tbody.innerHTML = '';
    if (isEquip && opts.addDefaults) {
      // 言語数が3以上の場合のみ通訳ユニットを言語数分に増やす（2言語以下は常に1台）
      const langCount = Math.max(1, Number(opts.languageCount) || 1);
      const unitQty   = langCount >= 3 ? langCount : 1;
      const eventDays = Math.max(1, Number(opts.eventDays) || 1);
      // 正規化済みAI品目をスロットにマッピングして決まった順で描画
      const slots = [
        { kw: 'ブース',           def: { name: '簡易卓上ブース',       quantity: 1,       unit: '台', days: eventDays, daysUnit: '日', unitPrice: 30000, venueCheckable: true } },
        { kw: '通訳ユニット',     def: { name: '通訳ユニット',         quantity: unitQty, unit: '台', days: eventDays, daysUnit: '日', unitPrice: 18000, venueCheckable: true } },
        { kw: 'FM無線送信機',     def: { name: 'FM無線送信機',         quantity: 2,       unit: '台', days: eventDays, daysUnit: '日', unitPrice: 2000 } },
        { kw: 'FM無線受信機',     def: { name: 'FM無線受信機',         quantity: 1,       unit: '台', days: eventDays, daysUnit: '日', unitPrice: 1000 } },
        { kw: '音響ミキサー',     def: { name: '音響ミキサー（小）',   quantity: 1,       unit: '台', days: eventDays, daysUnit: '日', unitPrice: 15000, venueCheckable: true } },
        { kw: '無線マイク',       def: { name: '無線マイク',           quantity: 1,       unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true } },
        { kw: '有線マイク',       def: { name: '有線マイク',           quantity: 1,       unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true } },
        { kw: 'スピーカー',       def: { name: 'スピーカー・音響設備', quantity: 1,       unit: '式', days: 0, daysUnit: '',   unitPrice: 0,     venueEquipment: true } },
        { kw: 'チーフエンジニア', def: { name: 'チーフエンジニア',     quantity: 1,       unit: '名', days: eventDays, daysUnit: '日', unitPrice: 35000 } },
        { kw: '機材運搬費',       def: { name: '機材運搬費',           quantity: 1,       unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 } },
        { kw: '設営',             def: { name: '設営・撤去費',         quantity: 1,       unit: '式', days: 0, daysUnit: '',   unitPrice: 30000 } },
      ];
      // ヘッドフォンアンプはデフォルト表示から除外（手動追加のみ）
      const aiItems  = (items || []).filter(it => !it.empty && !(it.name || '').includes('ヘッドフォンアンプ'));
      const usedAiIdx = new Set();
      slots.forEach(slot => {
        const idx = aiItems.findIndex((it, i) => !usedAiIdx.has(i) && (it.name || '').includes(slot.kw));
        if (idx !== -1) { usedAiIdx.add(idx); addItemRow(tbody, aiItems[idx], true); }
        else             { addItemRow(tbody, slot.def, true); }
      });
      // スロット未マッチのAI品目を末尾に追加
      aiItems.forEach((it, i) => { if (!usedAiIdx.has(i)) addItemRow(tbody, it, true); });
    } else {
      (items || []).forEach(item => {
        if (!item.empty) addItemRow(tbody, item, isEquip);
      });
    }
  }

  // ── 合計を再計算 ──────────────────────────────────────────
  function recalcTotal() {
    let total = 0;

    if (interpCard.style.display !== 'none') {
      let interpSum = 0;
      interpBody.querySelectorAll('tr:not(.mgmt-fee-row)').forEach(tr => {
        const venueChk = tr.querySelector('.venue-check');
        if (venueChk && venueChk.checked) {
          tr.querySelector('.td-sub').textContent = fmt(0);
          return;
        }
        const qtyIn   = tr.querySelector('.qty-input');
        const priceIn = tr.querySelector('.price-input');
        const daysIn  = tr.querySelector('.days-input');
        if (!qtyIn || !priceIn) return;
        const days = daysIn ? Number(daysIn.value) || 0 : 0;
        const sub = calcSubtotal(qtyIn.value, priceIn.value, days);
        tr.querySelector('.td-sub').textContent = fmt(sub);
        interpSum += sub;
      });
      const mgmtFee = Math.round(interpSum * 0.1);
      const mgmtRow = interpBody.querySelector('.mgmt-fee-row');
      if (mgmtRow) mgmtRow.querySelector('.td-sub').textContent = fmt(mgmtFee);
      total += interpSum + mgmtFee;
    }

    if (equipCard.style.display !== 'none') {
      const equipBodies = isSplitMode ? [studioBody, localBody] : [equipBody];
      equipBodies.forEach(body => {
        body.querySelectorAll('tr').forEach(tr => {
          const venueChk = tr.querySelector('.venue-check');
          if (venueChk && venueChk.checked) {
            tr.querySelector('.td-sub').textContent = fmt(0);
            return;
          }
          const qtyIn   = tr.querySelector('.qty-input');
          const priceIn = tr.querySelector('.price-input');
          const daysIn  = tr.querySelector('.days-input');
          if (!qtyIn || !priceIn) return;
          const days = daysIn ? Number(daysIn.value) || 0 : 0;
          const sub = calcSubtotal(qtyIn.value, priceIn.value, days);
          tr.querySelector('.td-sub').textContent = fmt(sub);
          total += sub;
        });
      });
    }

    totalAmountEl.textContent = fmt(total);
  }

  // ── テーブルから品目を収集 ───────────────────────────────
  function collectTableItems(tbody) {
    const items = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const nameIn     = tr.querySelector('.name-input');
      const qtyIn      = tr.querySelector('.qty-input');
      const unitIn     = tr.querySelector('.unit-input');
      const daysIn     = tr.querySelector('.days-input');
      const daysUnitIn = tr.querySelector('.days-unit-input');
      const priceIn    = tr.querySelector('.price-input');
      if (!nameIn || !priceIn) return;
      const venueChk = tr.querySelector('.venue-check');
      const isVenue  = venueChk ? venueChk.checked : false;
      const daysNum  = daysIn ? (Number(daysIn.value) || 0) : 0;
      items.push({
        name:           nameIn.value,
        quantity:       isVenue ? 0 : (Number(qtyIn ? qtyIn.value : 1) || 0),
        unit:           unitIn ? unitIn.value : '式',
        days:           isVenue ? 0 : daysNum,
        daysUnit:       daysUnitIn ? daysUnitIn.value : '',
        unitPrice:      isVenue ? 0 : (Number(priceIn.value) || 0),
        subtotal:       isVenue ? 0 : calcSubtotal(qtyIn ? qtyIn.value : 1, priceIn.value, daysNum),
        venueEquipment: isVenue,
      });
    });
    return items;
  }

  function collectData() {
    const interpretationItems = collectTableItems(interpBody);
    let equipmentItems, studioItems, localItems;
    if (isSplitMode) {
      studioItems    = collectTableItems(studioBody);
      localItems     = collectTableItems(localBody);
      equipmentItems = studioItems.concat(localItems);
    } else {
      equipmentItems = collectTableItems(equipBody);
      studioItems    = null;
      localItems     = null;
    }
    const allItems = interpretationItems.concat(equipmentItems);
    return {
      type:               fType.value,
      customerName:       fCustomer.value,
      projectName:        fProject.value,
      eventDate:          fDate.value,
      location:           fLocation ? fLocation.value : ((quoteData && quoteData.location) || ''),
      setup:              fSetup    ? fSetup.value    : '当日',
      teardown:           fTeardown ? fTeardown.value : '終了後',
      interpretationItems,
      equipmentItems,
      studioItems,
      localItems,
      isSplitMode,
      items:              allItems,
      totalAmount:        allItems.reduce((s, it) => s + it.subtotal, 0),
      rawEmail:           emailTextEl.value,
      discount:           Number((quoteData && quoteData.discount)      || 0),
      numDays:            Math.max(1, Number((quoteData && quoteData.numDays)      || 1)),
      interpreters:       Math.max(1, Number((quoteData && quoteData.interpreters) || 1)),
      outsideTokyo:       Boolean(quoteData && quoteData.outsideTokyo),
      isTaxExempt:        Boolean(quoteData && quoteData.isTaxExempt),
      languages:          (quoteData && quoteData.languages) || [],
      languageCount:      Number((quoteData && quoteData.languageCount) || 1),
      requiresStay:       Boolean(quoteData && quoteData.requiresStay),
      preDayEntry:        Boolean(quoteData && quoteData.preDayEntry),
      workingHours:       Number((quoteData && quoteData.workingHours) || 0),
      travelPattern:      (quoteData && quoteData.travelPattern) || 'none',
      transportRoute:     (quoteData && quoteData.transportRoute) || '',
    };
  }

  // ── 生成ボタン ────────────────────────────────────────────
  generateBtn.addEventListener('click', async () => {
    const emailText = emailTextEl.value.trim();
    if (!emailText) { showError('メール本文を入力してください。'); return; }
    clearError();
    generateBtn.disabled = true;
    loading.classList.add('show');
    previewArea.style.display = 'none';

    try {
      const res = await fetch('/api/quotes/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ emailText }),
      });
      if (res.status === 401) { location.href = '/login.html'; return; }
      const data = await res.json();
      if (!res.ok) { showError(data.message || '解析に失敗しました。'); return; }

      console.log('[quotes] API response type:', data.type);
      console.log('[quotes] interpretationItems:', JSON.stringify(data.interpretationItems));
      console.log('[quotes] equipmentItems names:', (data.equipmentItems || []).map(i => i.name));

      quoteData = data;

      fType.value     = data.type         || 'both';
      fCustomer.value = data.customerName || '';
      fProject.value  = data.projectName  || '';
      const timeStr = data.startTime
        ? ' ' + data.startTime + (data.endTime ? '〜' + data.endTime : '')
        : '';
      fDate.value = addDayOfWeek((data.eventDate || '') + timeStr);
      if (fLocation) fLocation.value = data.location || '';

      const eventDays = Math.max(1, Number(data.numDays) || 1);

      // 通訳品目：旅費系除外 → 言語別単価設定 → 単位マイグレーション → 管理費行追加
      const filteredInterp = filterInterpItems(data.interpretationItems);
      const pricedInterp   = applyInterpPricing(filteredInterp, data.languages);
      const migratedInterp = migrateItemUnits(pricedInterp, eventDays);
      renderTable(interpBody, migratedInterp, false);

      // 8時間超の場合は通訳料行の直後に延長料金行を追加
      // interpretationItemsに延長料金がない場合はworkingHoursから自動生成（フォールバック）
      const hasOvertimeInItems = (data.interpretationItems || []).some(function(it) { return /延長/.test(it.name || ''); });
      const wh = Number(data.workingHours) || 0;
      const overtimeByType = data.interpretationType === 'fullDayWithOvertime' && Number(data.overtimeUnits) > 0;
      const overtimeByHours = wh > 8;
      console.log('[quotes] overtime check:', { hasOvertimeInItems, wh, overtimeByType, overtimeByHours, interpretationType: data.interpretationType, overtimeUnits: data.overtimeUnits });
      if (!hasOvertimeInItems && (overtimeByType || overtimeByHours)) {
        const extraUnits = Number(data.overtimeUnits) > 0
          ? Number(data.overtimeUnits)
          : Math.ceil((wh - 8) * 2);
        const interps = Math.max(1, Number(data.interpreters) || 1);
        // 通訳料の行を探して直後に挿入
        let interpFeeRow = null;
        interpBody.querySelectorAll('tr').forEach(function(tr) {
          const nameIn = tr.querySelector('.name-input');
          if (nameIn && /通訳料/.test(nameIn.value)) interpFeeRow = tr;
        });
        const insertBefore = interpFeeRow ? interpFeeRow.nextSibling : null;
        console.log('[quotes] adding overtime row:', { extraUnits, interps, insertBefore: !!insertBefore });
        addItemRow(interpBody, {
          name:      '延長料金',
          quantity:  extraUnits,  // コマ数（30分単位）
          unit:      'コマ',
          days:      interps,     // 名数
          daysUnit:  '名',
          unitPrice: 7000,
        }, false, insertBefore || undefined);
      }

      addMgmtFeeRow(interpBody);

      // 機材品目：正規化 → venueフラグ付与 → 重複除去 → 単位マイグレーション → 描画
      setEquipMode(false);
      const normalizedEquip = normalizeEquipItems(data.equipmentItems || []);
      const markedEquip     = markVenueCheckable(normalizedEquip);
      const dedupedEquip    = deduplicateEquipItems(markedEquip);
      const migratedEquip   = migrateItemUnits(dedupedEquip, eventDays);
      const langCount       = data.languageCount || (data.languages ? data.languages.length : 1);
      renderTable(equipBody, migratedEquip, true, { addDefaults: true, languageCount: langCount, eventDays: eventDays });

      updateCardVisibility();
      previewArea.style.display = 'block';
      previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showError('通信エラーが発生しました: ' + err.message);
    } finally {
      generateBtn.disabled = false;
      loading.classList.remove('show');
    }
  });

  // ── 行追加ボタン ──────────────────────────────────────────
  addInterpBtn.addEventListener('click', () => {
    const mgmtRow = interpBody.querySelector('.mgmt-fee-row');
    addItemRow(interpBody, null, false, mgmtRow || undefined);
  });
  if (addEquipBtn)  addEquipBtn.addEventListener('click',  () => addItemRow(equipBody,  null, true));
  if (addStudioBtn) addStudioBtn.addEventListener('click', () => addItemRow(studioBody, null, true));
  if (addLocalBtn)  addLocalBtn.addEventListener('click',  () => addItemRow(localBody,  null, true));

  // ── プリセットボタン ──────────────────────────────────────
  const presetBtnsEl = document.getElementById('equipPresetBtns');
  if (presetBtnsEl) {
    Object.values(PRESETS).forEach(preset => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => {
        if (!confirm('現在の機材品目をクリアして読み込みますか？')) return;
        if (preset.split) {
          setEquipMode(true);
          renderTable(studioBody, preset.studioItems, true);
          renderTable(localBody,  preset.localItems,  true);
        } else {
          setEquipMode(false);
          renderTable(equipBody, preset.items, true);
        }
        recalcTotal();
      });
      presetBtnsEl.appendChild(btn);
    });
  }

  // ── ドラッグ&ドロップ初期化 ───────────────────────────────
  initDragDrop(interpBody);
  initDragDrop(equipBody);
  initDragDrop(studioBody);
  initDragDrop(localBody);

  // ── PDF生成（プレビュー・ダウンロード共通）────────────────
  function buildAndPrintPDF(d) {
    const locStr         = d.location;
    const interpreters   = d.interpreters;
    const discount       = d.discount;
    const isOutsideTokyo = d.outsideTokyo;
    const interpItems    = d.interpretationItems;
    const equipItems     = d.equipmentItems;
    const numDays        = d.numDays;
    const workingHours   = d.workingHours || 0;
    const travelPattern  = d.travelPattern || 'none';
    const isTaxExempt    = d.isTaxExempt ||
      /国連|UN\b|UNESCO|WHO|UNDP|UNICEF|WFP|ILO|IMF|OECD|世界銀行/i.test(d.customerName || '');

    const now = new Date();
    const dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';

    function fmtYen(n)     { return (Number(n) || 0).toLocaleString('ja-JP') + '円'; }
    function fmtAt(n)      { return '@' + (Number(n) || 0).toLocaleString('ja-JP'); }
    function fmtYenMark(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
    function fmtNum(n)     { return (Number(n) || 0).toLocaleString('ja-JP'); }

    function fmtQty(it) {
      const unit     = (it.unit     || '').trim();
      const daysUnit = (it.daysUnit || '').trim();
      const qty      = Number(it.quantity) || 1;
      const days     = Number(it.days) || 0;

      // 旧フォーマット（「台/日」のように「/」を含む）後方互換
      if (unit.includes('/')) {
        const slash     = unit.indexOf('/');
        const leftUnit  = unit.substring(0, slash).trim();
        const rightUnit = unit.substring(slash + 1).trim();
        if (rightUnit === '半日') return qty + leftUnit + '×半日';
        if (rightUnit === '日')   return qty + leftUnit + '×' + (days || numDays) + '日';
        if (rightUnit === '時間') return qty + leftUnit + '×' + (days || 1) + '時間';
        if (rightUnit === '回')   return qty + leftUnit + '×' + (days || 1) + '回';
        return qty + esc(unit);
      }

      if (unit === '式' || unit === '一式') return '一式';
      if (!daysUnit) return qty + esc(unit);
      if (daysUnit === '半日') return qty + unit + '×半日';
      if (daysUnit === '日')   return qty + unit + '×' + (days || 1) + '日';
      if (daysUnit === '時間') return qty + unit + '×' + (days || 1) + '時間';
      if (daysUnit === '回')   return qty + unit + '×' + (days || 1) + '回';
      return qty + esc(unit) + (days ? '×' + days + esc(daysUnit) : '');
    }

    const customer = d.customerName
      ? esc(d.customerName) + '　御中'
      : '　　　　　　　　　　御中';

    function headerHTML() {
      return ''
        + '<div class="date-row">' + dateStr + '</div>'
        + '<div class="addr-row">'
        + '  <div class="customer-block">' + customer + '</div>'
        + '  <div class="sender-block">'
        + '    <img src="/images/logo.png" style="height:44px; display:block; margin-bottom:6px;" />'
        + '    〒150-0047　東京都渋谷区神山町 5-5<br>'
        + '    株式会社 NHKグローバルメディアサービス<br>'
        + '    国際事業センター<br>'
        + '    Tel:03-5453-8458　Fax:03-5453-3485'
        + '  </div>'
        + '</div>';
    }

    function subjectHTML(pageType) {
      const langs = (Array.isArray(d.languages) && d.languages.length > 0)
        ? d.languages.join('・') : '';
      let text;
      if (pageType === 'equipment') {
        // 案件名がある場合のみ（）を付ける
        text = d.projectName
          ? '同時通訳機器レンタル（' + esc(d.projectName) + '）業務'
          : '同時通訳機器レンタル業務';
      } else {
        const parts = [];
        if (d.projectName) parts.push(esc(d.projectName));
        if (langs) parts.push(langs);
        parts.push('同時通訳業務');
        text = parts.join('　');
      }
      const subLabel = pageType === 'equipment' ? '（機器レンタル費用など）' : '（通訳費用など）';
      return ''
        + '<div class="sub-title">' + subLabel + '</div>'
        + '<div class="subject-row">'
        + '  <span class="subject-label">件　名　：</span>'
        + '  <span class="subject-text">' + text + '</span>'
        + '</div>';
    }

    function buildInterpPage() {
      let rowNum = 1;
      let itemRows = '';
      interpItems.forEach(function(it) {
        const n = rowNum++;
        itemRows += '<tr>'
          + '<td class="td-name">' + n + ')&ensp;' + esc(it.name) + '</td>'
          + '<td class="td-price">' + (it.unitPrice > 0 ? fmtAt(it.unitPrice) : '') + '</td>'
          + '<td class="td-qty">' + fmtQty(it) + '</td>'
          + '<td class="td-sub">' + fmtYen(it.subtotal) + '</td>'
          + '</tr>';
      });

      const interpFeeTotal = interpItems.reduce(function(s, it) { return s + it.subtotal; }, 0);

      // 延長料はUIテーブルに含まれている場合はinterpFeeTotalに含まれるため自動計算不要
      // テーブルに延長料がない場合（旧データ等）のみフォールバックとして自動計算
      const hasOvertimeItem = interpItems.some(function(it) { return /延長/.test(it.name || ''); });
      let overtimeRow = '';
      let overtimeFee = 0;
      if (!hasOvertimeItem && workingHours > 8) {
        const extraHours   = workingHours - 8;
        const extra05Units = Math.ceil(extraHours / 0.5);
        overtimeFee = 7000 * interpreters * extra05Units;
        const overN = rowNum++;
        overtimeRow = '<tr>'
          + '<td class="td-name">' + overN + ')&ensp;延長料</td>'
          + '<td class="td-price">' + fmtAt(7000) + '</td>'
          + '<td class="td-qty">' + interpreters + '名×' + extra05Units + 'コマ</td>'
          + '<td class="td-sub">' + fmtYen(overtimeFee) + '</td>'
          + '</tr>';
      }

      const mgmtBase = interpFeeTotal + overtimeFee;
      const mgmtFee  = Math.round(mgmtBase * 0.1);
      // 通訳料がある場合のみ管理費を表示
      let mgmtRow = '';
      if (interpItems.length > 0) {
        const mgmtNum = rowNum++;
        mgmtRow = '<tr>'
          + '<td class="td-name">' + mgmtNum + ')&ensp;管理費</td>'
          + '<td class="td-price td-note">上記通訳料合計の10%</td>'
          + '<td class="td-qty"></td>'
          + '<td class="td-sub">' + fmtYen(mgmtFee) + '</td>'
          + '</tr>';
      }

      const travelUnit = 28000, dailyUnit = 8000;
      let travelFee = 0, dailyFee = 0;
      let travelRows = '';

      if (isOutsideTokyo && travelPattern !== 'none') {
        let travelCount = 0, dailyCount = 0;
        let travelQtyStr = '', dailyQtyStr = '';

        if (travelPattern === 'sameDay') {
          travelCount = 2; dailyCount = 1;
          travelQtyStr = interpreters + '名×2回';
          dailyQtyStr  = interpreters + '名×1泊';
        } else if (travelPattern === 'preDay') {
          travelCount = 2; dailyCount = 2;
          travelQtyStr = interpreters + '名×2回';
          dailyQtyStr  = interpreters + '名×2泊';
        } else if (travelPattern === 'dayTrip') {
          travelCount = 1; dailyCount = 0;
          travelQtyStr = interpreters + '名×1回';
        }

        travelFee = travelUnit * interpreters * travelCount;
        dailyFee  = dailyUnit  * interpreters * dailyCount;

        if (travelFee > 0) {
          const tN = rowNum++;
          travelRows += '<tr>'
            + '<td class="td-name">' + tN + ')&ensp;移動拘束費</td>'
            + '<td class="td-price">' + fmtAt(travelUnit) + '</td>'
            + '<td class="td-qty">' + travelQtyStr + '</td>'
            + '<td class="td-sub">' + fmtYen(travelFee) + '</td>'
            + '</tr>';
        }
        if (dailyFee > 0) {
          const dN = rowNum++;
          travelRows += '<tr>'
            + '<td class="td-name">' + dN + ')&ensp;日当</td>'
            + '<td class="td-price">' + fmtAt(dailyUnit) + '</td>'
            + '<td class="td-qty">' + dailyQtyStr + '</td>'
            + '<td class="td-sub">' + fmtYen(dailyFee) + '</td>'
            + '</tr>';
        }
        const transportLabel = d.transportRoute
          ? '交通費（' + esc(d.transportRoute) + '）' : '交通費';
        const transN = rowNum++;
        travelRows += '<tr>'
          + '<td class="td-name">' + transN + ')&ensp;' + transportLabel + '</td>'
          + '<td class="td-jitsubi" colspan="2">実費で請求させていただきます</td>'
          + '<td class="td-sub" style="text-align:center; font-style:italic; color:#444;">実費</td>'
          + '</tr>';
        if (d.requiresStay) {
          const stayN = rowNum++;
          travelRows += '<tr>'
            + '<td class="td-name">' + stayN + ')&ensp;宿泊費</td>'
            + '<td class="td-jitsubi" colspan="2">実費で請求させていただきます</td>'
            + '<td class="td-sub" style="text-align:center; font-style:italic; color:#444;">実費</td>'
            + '</tr>';
        }
      }

      const totalBeforeTax = mgmtBase + mgmtFee + travelFee + dailyFee;
      const tax   = isTaxExempt ? 0 : Math.round(totalBeforeTax * 0.1);
      const grand = totalBeforeTax + tax;

      return '<div class="page">'
        + headerHTML()
        + '<div class="main-title">御　見　積　書</div>'
        + subjectHTML('interpretation')
        + '<table class="items-tbl">'
        + '<thead><tr>'
        + '<th class="th-name">項　目</th>'
        + '<th class="th-price">単　価</th>'
        + '<th class="th-qty">数　量</th>'
        + '<th class="th-sub">小　計</th>'
        + '</tr></thead>'
        + '<tbody>'
        + itemRows
        + overtimeRow
        + mgmtRow
        + travelRows
        + '<tr class="empty-row"><td colspan="4">&nbsp;</td></tr>'
        + '<tr class="empty-row"><td colspan="4">&nbsp;</td></tr>'
        + '</tbody></table>'
        + '<div class="totals-wrap"><table class="totals-tbl">'
        + '<tr><td class="tl">小　計</td><td class="tr">' + fmtYen(totalBeforeTax) + '</td></tr>'
        + '<tr><td class="tl">消費税（10%）</td><td class="tr">' + (isTaxExempt ? '免税' : fmtYen(tax)) + '</td></tr>'
        + '<tr class="grand-row"><td class="tl">合　計' + (isTaxExempt ? '' : '　＊') + '</td><td class="tr">' + fmtYen(grand) + '</td></tr>'
        + '</table></div>'
        + '<div class="notes-block">'
        + (!isTaxExempt ? '<p class="star-note">＊は消費税額を含む金額であることを示します</p>' : '')
        + '<table class="notes-tbl">'
        + '<tr><td>納入日</td><td>：</td><td>' + (d.eventDate ? esc(addDayOfWeek(d.eventDate)) : '「項目」欄を参照') + '</td></tr>'
        + '<tr><td>納入場所</td><td>：</td><td>' + (d.location ? esc(d.location) : '「項目」欄を参照') + '</td></tr>'
        + '<tr><td>お支払</td><td>：</td><td>請求日より30日以内銀行振込</td></tr>'
        + '<tr>'
        + '<td style="vertical-align:top; white-space:nowrap;">その他</td>'
        + '<td style="vertical-align:top;">：</td>'
        + '<td><ul class="notes-list">'
        + '<li>通訳料半日とは、午前または午後4時間以内の拘束（実働3時間以内）を意味します</li>'
        + '<li>通訳料1日とは、4時間以上8時間以内の拘束（休憩含む）を意味します</li>'
        + '<li>8時間を超える拘束については、30分ごとに7,000円の延長料が発生します</li>'
        + '<li>実働が3時間を超える同時通訳業務は、2名での対応となります</li>'
        + '<li>通訳のキャンセル料は、当日・前日100%、2〜3日前50%、4〜7日前30%となります</li>'
        + '</ul></td>'
        + '</tr>'
        + '</table></div>'
        + '</div>';
    }

    function buildEquipSummaryPage() {
      const equipTotal = equipItems.reduce(function(s, it) {
        const qty  = Math.max(1, Number(it.quantity) || 1);
        const days = Number(it.days) > 0 ? Number(it.days) : 1;
        return s + qty * days * (Number(it.unitPrice) || 0);
      }, 0);
      const discountedTotal = Math.max(0, equipTotal - discount);
      const tax   = isTaxExempt ? 0 : Math.round(discountedTotal * 0.1);
      const grand = discountedTotal + tax;

      const discountRow = discount > 0
        ? '<tr><td class="td-name">お値引き</td><td></td><td></td><td class="td-sub">▲' + fmtYen(discount) + '</td></tr>'
        : '';

      return '<div class="page">'
        + headerHTML()
        + '<div class="main-title">御　見　積　書</div>'
        + subjectHTML('equipment')
        + '<table class="items-tbl">'
        + '<thead><tr>'
        + '<th class="th-name">項　目</th>'
        + '<th class="th-price">単　価</th>'
        + '<th class="th-qty">数　量</th>'
        + '<th class="th-sub">小　計</th>'
        + '</tr></thead>'
        + '<tbody>'
        + '<tr><td class="td-name">1)&ensp;同時通訳機器レンタル費用など</td><td class="td-price td-center">明細参照</td><td class="td-qty">一式</td><td class="td-sub">' + fmtYen(equipTotal) + '</td></tr>'
        + discountRow
        + '<tr class="empty-row"><td colspan="4">&nbsp;</td></tr>'
        + '<tr class="empty-row"><td colspan="4">&nbsp;</td></tr>'
        + '</tbody></table>'
        + '<div class="totals-wrap"><table class="totals-tbl">'
        + '<tr><td class="tl">小　計</td><td class="tr">' + fmtYen(discountedTotal) + '</td></tr>'
        + '<tr><td class="tl">消費税（10%）</td><td class="tr">' + (isTaxExempt ? '免税' : fmtYen(tax)) + '</td></tr>'
        + '<tr class="grand-row"><td class="tl">合　計' + (isTaxExempt ? '' : '　＊') + '</td><td class="tr">' + fmtYen(grand) + '</td></tr>'
        + '</table></div>'
        + '<div class="notes-block">'
        + (!isTaxExempt ? '<p class="star-note">＊は消費税額を含む金額であることを示します</p>' : '')
        + '<table class="notes-tbl">'
        + '<tr><td>納入日</td><td>：</td><td>' + (d.eventDate ? esc(addDayOfWeek(d.eventDate)) : '「同時通訳機器レンタル費用など明細」参照') + '</td></tr>'
        + '<tr><td>納入場所</td><td>：</td><td>' + (locStr ? esc(locStr) : '「同時通訳機器レンタル費用など明細」参照') + '</td></tr>'
        + '<tr><td>お支払</td><td>：</td><td>請求日より30日以内銀行振込</td></tr>'
        + '</table></div>'
        + '</div>';
    }

    function buildEquipDetailPage(items, titleSuffix) {
      items = items || equipItems;
      const pageTitle = '同時通訳機器レンタル費用など明細' + (titleSuffix ? '（' + titleSuffix + '）' : '');
      let detailTotal = 0;
      let detailRows = '';
      items.forEach(function(it) {
        if (it.venueEquipment) {
          detailRows += '<tr>'
            + '<td class="td-name">' + esc(it.name) + '</td>'
            + '<td class="td-center venue-equip" colspan="3">会場常設を使用</td>'
            + '<td class="td-right">0</td>'
            + '</tr>';
        } else {
          const qty    = Math.max(1, Number(it.quantity) || 1);
          const days   = Number(it.days) > 0 ? Number(it.days) : 1;
          const amount = qty * days * (Number(it.unitPrice) || 0);
          detailTotal += amount;
          detailRows += '<tr>'
            + '<td class="td-name">' + esc(it.name) + '</td>'
            + '<td class="td-center">' + qty + '</td>'
            + '<td class="td-center">' + days + '</td>'
            + '<td class="td-right">' + fmtYenMark(it.unitPrice) + '</td>'
            + '<td class="td-right">' + fmtNum(amount) + '</td>'
            + '</tr>';
        }
      });

      // 合計行：左端空欄（枠なし）＋「合計金額」(台数+日数 colspan=2)＋金額(単価+金額 colspan=2)
      const totalRow = '<tr>'
        + '<td style="border:none; background:#fff;"></td>'
        + '<td colspan="2" style="border:1px solid #000; border-top:2px solid #000; border-left:1px solid #000; text-align:center; font-weight:bold; font-size:11pt; white-space:nowrap;">合　計　金　額</td>'
        + '<td colspan="2" style="border:1px solid #000; border-top:2px solid #000; text-align:right; font-weight:bold; font-size:11pt;">' + fmtYen(detailTotal) + '</td>'
        + '</tr>';

      return '<div class="page">'
        + '<div class="detail-title-box">' + pageTitle + '</div>'
        + '<div class="addr-row">'
        + '<div class="customer-block">' + customer + '</div>'
        + '<div class="sender-block">'
        + '<img src="/images/logo.png" style="height:44px; display:block; margin-bottom:6px;" />'
        + '〒150-0047　東京都渋谷区神山町 5-5<br>'
        + 'Tel:03-5453-8458　Fax:03-5453-3485'
        + '</div>'
        + '</div>'
        + '<table class="info-tbl">'
        + '<tr><td class="info-label">件　　　名</td><td class="info-sep">：</td><td class="info-val">' + (d.projectName ? esc(d.projectName) : '') + '</td></tr>'
        + '<tr><td class="info-label">納　入　日</td><td class="info-sep">：</td><td class="info-val">' + (d.eventDate ? esc(addDayOfWeek(d.eventDate)) : '') + '</td></tr>'
        + '<tr><td class="info-label">納入場所</td><td class="info-sep">：</td><td class="info-val">' + (locStr ? esc(locStr) : '') + '</td></tr>'
        + '<tr><td class="info-label">設　　　営</td><td class="info-sep">：</td><td class="info-val">' + esc(d.setup || '当日') + '</td></tr>'
        + '<tr><td class="info-label">撤　　　去</td><td class="info-sep">：</td><td class="info-val">' + esc(d.teardown || '終了後') + '</td></tr>'
        + '</table>'
        + '<table class="items-tbl detail-tbl">'
        + '<thead><tr>'
        + '<th class="th-name">項　目</th>'
        + '<th class="th-center">台数</th>'
        + '<th class="th-center">日数</th>'
        + '<th class="th-right">単　価</th>'
        + '<th class="th-right">金　額</th>'
        + '</tr></thead>'
        + '<tbody>'
        + detailRows
        + '<tr class="empty-row"><td colspan="5">&nbsp;</td></tr>'
        + '<tr class="empty-row"><td colspan="5">&nbsp;</td></tr>'
        + totalRow
        + '</tbody></table>'
        + '<div class="notes-block">'
        + '<p>合計金額に消費税は含まれていません。</p>'
        + '<p>レシーバー（FM無線受信機）紛失の際には、補償費を申し受けます（38,000円/1台）。</p>'
        + '</div>'
        + '</div>';
    }

    const equipDetailPages = (d.isSplitMode && d.studioItems && d.localItems)
      ? buildEquipDetailPage(d.studioItems, 'スタジオ') + buildEquipDetailPage(d.localItems, '現地配信')
      : buildEquipDetailPage();
    let bodyContent;
    if (d.type === 'both') {
      bodyContent = buildInterpPage() + buildEquipSummaryPage() + equipDetailPages;
    } else if (d.type === 'equipment') {
      bodyContent = buildEquipSummaryPage() + equipDetailPages;
    } else {
      bodyContent = buildInterpPage();
    }

    const css = [
      '* { box-sizing: border-box; margin: 0; padding: 0; }',
      'body { font-family: "MS Mincho", "Yu Mincho", "Hiragino Mincho ProN", "HiraMinProN-W3", serif; font-size: 10.5pt; color: #000; background: #fff; }',
      '.page { width: 210mm; min-height: 297mm; padding: 15mm; }',
      '.date-row { text-align: right; margin-bottom: 12px; font-size: 10pt; }',
      '.addr-row { display: flex; justify-content: space-between; align-items: flex-start; min-height: 80px; margin-bottom: 20px; }',
      '.customer-block { font-size: 14pt; font-weight: bold; }',
      '.sender-block { text-align: right; line-height: 1.7; font-size: 9pt; }',
      '.main-title { text-align: center; font-size: 20pt; font-weight: bold; margin-top: 20px; margin-bottom: 4px; letter-spacing: 0.15em; }',
      '.sub-title { text-align: center; font-size: 10pt; margin-bottom: 10px; }',
      // 明細タイトル：文字サイズに合わせた幅・高さ
      '.detail-title-box { display: table; width: auto; margin: 0 auto 15px; text-align: center; font-size: 16pt; font-weight: bold; border: 2px solid #000; padding: 3px 24px; letter-spacing: 0.05em; }',
      // 情報テーブル：項目+台数+日数列幅（40+8+8=56%）に揃える
      '.info-tbl { border-collapse: collapse; width: 56%; margin: 0 0 15px; font-size: 10pt; }',
      '.info-tbl td { border: 1px solid #000; padding: 4px 6px; text-align: left; }',
      '.info-label { font-weight: bold; white-space: nowrap; width: 90px; }',
      '.info-sep { text-align: left; white-space: nowrap; width: 16px; }',
      '.subject-row { display: flex; justify-content: center; align-items: baseline; font-size: 10.5pt; margin-bottom: 16px; }',
      '.subject-label { white-space: nowrap; }',
      '.subject-text { border-bottom: 1px solid #000; padding: 0 16px 2px; min-width: 60px; }',
      '.items-tbl { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 0; }',
      '.items-tbl th, .items-tbl td { border: 1px solid #000; padding: 5px 8px; font-size: 10pt; }',
      '.items-tbl th { text-align: center; font-weight: bold; }',
      '.th-name { width: 50%; }',
      '.th-price { width: 15%; }',
      '.th-qty { width: 15%; }',
      '.th-sub { width: 20%; }',
      '.th-center { text-align: center; }',
      '.th-right { text-align: right; }',
      // 明細テーブル列幅：項目40+台数8+日数8+単価20+金額24
      '.detail-tbl th:nth-child(1) { width: 40%; }',
      '.detail-tbl th:nth-child(2) { width: 8%; }',
      '.detail-tbl th:nth-child(3) { width: 8%; }',
      '.detail-tbl th:nth-child(4) { width: 20%; }',
      '.detail-tbl th:nth-child(5) { width: 24%; }',
      '.detail-tbl th, .detail-tbl td { padding: 4px 6px; white-space: nowrap; }',
      '.detail-tbl .td-name { white-space: normal; }',
      '.td-jitsubi { text-align: center; background: #f3f4f6; font-size: 0.9em; padding: 4px 8px; color: #374151; white-space: nowrap; }',
      '.venue-equip { text-align: center; background: #f3f4f6; font-style: italic; }',
      '.empty-row td { height: 22px; }',
      '.td-name { text-align: left; }',
      '.td-price { text-align: right; }',
      '.td-qty { text-align: right; white-space: nowrap; min-width: 80px; font-size: 0.9em; }',
      '.td-sub { text-align: right; }',
      '.td-center { text-align: center; }',
      '.td-right { text-align: right; }',
      '.td-note { text-align: center; font-size: 0.85em; white-space: nowrap; }',
      '.totals-wrap { margin: 8px 0 14px; }',
      '.totals-tbl { border-collapse: collapse; width: 35%; margin-left: auto; }',
      '.totals-tbl td { border: 1px solid #000; padding: 4px 10px; font-size: 10pt; }',
      '.totals-tbl .tl { text-align: left; white-space: nowrap; width: 43%; }',
      '.totals-tbl .tr { text-align: right; }',
      '.grand-row td { font-weight: bold; font-size: 11pt; }',
      '.notes-block { margin-top: 16px; font-size: 9pt; }',
      '.star-note { margin-bottom: 6px; }',
      '.notes-tbl { border-collapse: collapse; margin-bottom: 10px; font-size: 0.85em; }',
      '.notes-tbl td { padding: 2px 6px; vertical-align: top; }',
      '.notes-tbl td:first-child { white-space: nowrap; }',
      '.notes-list { list-style: none; padding-left: 0; margin: 0; }',
      '.notes-list li { margin-bottom: 2px; }',
      '.notes-list li::before { content: "・"; }',
      '@page { size: A4; margin: 15mm; }',
      '@media print {',
      '  body { margin: 0; }',
      '  .page { padding: 0; width: auto; min-height: auto; page-break-after: always; }',
      '  .page:last-child { page-break-after: avoid; }',
      '}',
    ].join('\n');

    const html = '<!doctype html>\n'
      + '<html lang="ja">\n'
      + '<head><meta charset="utf-8"><title></title><style>' + css + '</style></head>\n'
      + '<body>' + bodyContent + '</body>\n'
      + '</html>';

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.document.title = '';
      if (win.document.readyState === 'complete') win.print();
      else win.addEventListener('load', function() { win.print(); });
    } else {
      showError('ポップアップがブロックされました。ブラウザの設定を確認してください。');
    }
  }

  // ── ページ離脱時にメール本文・解析結果をメモリから消去 ──
  window.addEventListener('beforeunload', () => {
    emailTextEl.value = '';
    quoteData = null;
  });

  // ── PDF確認ボタン（別タブでプレビュー）─────────────────
  if (pdfBtn) {
    pdfBtn.addEventListener('click', () => buildAndPrintPDF(collectData()));
  }

  // ── まとめてダウンロードボタン ────────────────────────────
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const d     = collectData();
      const fname = buildFileName(d);

      try {
        downloadBtn.disabled = true;
        const res = await fetch('/api/quotes/export/excel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(d),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showError('Excel生成に失敗しました: ' + (err.message || res.status));
          return;
        }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = fname + '.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showError('通信エラーが発生しました: ' + err.message);
        return;
      } finally {
        downloadBtn.disabled = false;
      }

      setTimeout(() => {
        const msg = 'Excelをダウンロードしました。\n\n次にPDFを保存します。\n印刷ダイアログで「PDFに保存」を選択し、\nファイル名を以下にしてください:\n\n' + fname + '.pdf\n\n[OK] で印刷ダイアログを開きます。';
        if (confirm(msg)) buildAndPrintPDF(d);
      }, 400);
    });
  }

})();
