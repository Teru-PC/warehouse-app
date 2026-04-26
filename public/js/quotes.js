(function () {
  const token = window.authUtils ? window.authUtils.getToken() : '';
  if (!token) {
    location.href = '/login.html';
    return;
  }

  // ── 価格マスタをフェッチしてオートコンプリート用datalistを作成 ──
  fetch('/api/quotes/price-master', { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return;
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

  const interpCard    = document.getElementById('interpCard');
  const interpBody    = document.getElementById('interpBody');
  const addInterpBtn  = document.getElementById('addInterpBtn');

  const equipCard     = document.getElementById('equipCard');
  const equipBody     = document.getElementById('equipBody');
  const addEquipBtn   = document.getElementById('addEquipBtn');

  const totalAmountEl = document.getElementById('totalAmount');
  const excelBtn      = document.getElementById('excelBtn');
  const pdfBtn        = document.getElementById('pdfBtn');

  // ── 状態 ─────────────────────────────────────────────────
  let quoteData = null;

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
  function calcSubtotal(qty, price) {
    return (Number(qty) || 0) * (Number(price) || 0);
  }
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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

  // ── 品目行を追加 ──────────────────────────────────────────
  function addItemRow(tbody, item, isEquip) {
    item = item || { name: '', quantity: 1, unit: '式', unitPrice: 0 };
    const isVenue = isEquip && Boolean(item.venueEquipment);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-name"><input type="text" class="name-input" value="${esc(item.name)}" placeholder="品名" list="itemNameList" /></td>
      <td>
        ${isEquip ? `<label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px;white-space:nowrap;">
          <input type="checkbox" class="venue-check" ${isVenue ? 'checked' : ''}>常設
        </label>` : ''}
        <input type="number" class="qty-input" value="${Number(item.quantity) || 1}" min="0" style="width:60px;${isVenue ? 'display:none;' : ''}" />
      </td>
      <td><input type="text" class="unit-input" value="${esc(item.unit || '式')}" style="width:50px;" /></td>
      <td><input type="number" class="price-input" value="${Number(item.unitPrice) || 0}" min="0" step="100" /></td>
      <td class="td-sub">${isVenue ? fmt(0) : fmt(calcSubtotal(item.quantity, item.unitPrice))}</td>
      <td class="td-del"><button class="del-btn" type="button" title="削除">×</button></td>
    `;
    const qtyIn   = tr.querySelector('.qty-input');
    const priceIn = tr.querySelector('.price-input');
    function updateSub() {
      const venueChk = tr.querySelector('.venue-check');
      if (venueChk && venueChk.checked) {
        tr.querySelector('.td-sub').textContent = fmt(0);
      } else {
        tr.querySelector('.td-sub').textContent = fmt(calcSubtotal(qtyIn.value, priceIn.value));
      }
      recalcTotal();
    }
    if (isEquip) {
      const venueChk = tr.querySelector('.venue-check');
      venueChk.addEventListener('change', () => {
        qtyIn.style.display = venueChk.checked ? 'none' : '';
        updateSub();
      });
    }
    qtyIn.addEventListener('input', updateSub);
    priceIn.addEventListener('input', updateSub);
    tr.querySelector('.del-btn').addEventListener('click', () => { tr.remove(); recalcTotal(); });
    tbody.appendChild(tr);
  }

  function renderTable(tbody, items, isEquip) {
    tbody.innerHTML = '';
    (items || []).forEach(item => addItemRow(tbody, item, isEquip));
  }

  // ── 合計を再計算 ──────────────────────────────────────────
  function recalcTotal() {
    let total = 0;
    function sumTable(tbody) {
      tbody.querySelectorAll('tr').forEach(tr => {
        const venueChk = tr.querySelector('.venue-check');
        if (venueChk && venueChk.checked) {
          tr.querySelector('.td-sub').textContent = fmt(0);
          return;
        }
        const qtyIn   = tr.querySelector('.qty-input');
        const priceIn = tr.querySelector('.price-input');
        if (!qtyIn || !priceIn) return;
        const sub = calcSubtotal(qtyIn.value, priceIn.value);
        tr.querySelector('.td-sub').textContent = fmt(sub);
        total += sub;
      });
    }
    if (interpCard.style.display !== 'none') sumTable(interpBody);
    if (equipCard.style.display  !== 'none') sumTable(equipBody);
    totalAmountEl.textContent = fmt(total);
  }

  // ── テーブルから品目を収集 ───────────────────────────────
  function collectTableItems(tbody) {
    const items = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const nameIn  = tr.querySelector('.name-input');
      const qtyIn   = tr.querySelector('.qty-input');
      const unitIn  = tr.querySelector('.unit-input');
      const priceIn = tr.querySelector('.price-input');
      if (!nameIn || !priceIn) return;
      const venueChk = tr.querySelector('.venue-check');
      const isVenue  = venueChk ? venueChk.checked : false;
      items.push({
        name:           nameIn.value,
        quantity:       isVenue ? 0 : (Number(qtyIn ? qtyIn.value : 1) || 0),
        unit:           unitIn ? unitIn.value : '式',
        unitPrice:      isVenue ? 0 : (Number(priceIn.value) || 0),
        subtotal:       isVenue ? 0 : calcSubtotal(qtyIn ? qtyIn.value : 1, priceIn.value),
        venueEquipment: isVenue,
      });
    });
    return items;
  }

  function collectData() {
    const interpretationItems = collectTableItems(interpBody);
    const equipmentItems      = collectTableItems(equipBody);
    const allItems = interpretationItems.concat(equipmentItems);
    return {
      type:               fType.value,
      customerName:       fCustomer.value,
      projectName:        fProject.value,
      eventDate:          fDate.value,
      location:           fLocation ? fLocation.value : ((quoteData && quoteData.location) || ''),
      interpretationItems,
      equipmentItems,
      items:              allItems,
      totalAmount:        allItems.reduce((s, it) => s + it.subtotal, 0),
      rawEmail:           emailTextEl.value,
      discount:           Number((quoteData && quoteData.discount)      || 0),
      numDays:            Math.max(1, Number((quoteData && quoteData.numDays)      || 1)),
      interpreters:       Math.max(1, Number((quoteData && quoteData.interpreters) || 1)),
      outsideTokyo:       Boolean(quoteData && quoteData.outsideTokyo),
      isTaxExempt:        Boolean(quoteData && quoteData.isTaxExempt),
      languages:          (quoteData && quoteData.languages) || [],
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

      quoteData = data;

      fType.value    = data.type        || 'both';
      fCustomer.value = data.customerName || '';
      fProject.value  = data.projectName  || '';
      fDate.value     = data.eventDate    || '';
      if (fLocation) fLocation.value = data.location || '';

      renderTable(interpBody, data.interpretationItems || [], false);
      renderTable(equipBody,  data.equipmentItems      || [], true);
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
  addInterpBtn.addEventListener('click', () => addItemRow(interpBody, null, false));
  addEquipBtn.addEventListener('click',  () => addItemRow(equipBody,  null, true));

  // ── Excel ダウンロード（サーバーサイド xlsx）─────────────
  excelBtn.addEventListener('click', async () => {
    const d = collectData();
    try {
      excelBtn.disabled = true;
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
      a.download = `見積書_${d.customerName || '未設定'}_${d.eventDate || ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError('通信エラーが発生しました: ' + err.message);
    } finally {
      excelBtn.disabled = false;
    }
  });

  // ── PDF ダウンロード ──────────────────────────────────────
  pdfBtn.addEventListener('click', () => {
    const d              = collectData();
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

    // 金額フォーマット
    function fmtYen(n)     { return (Number(n) || 0).toLocaleString('ja-JP') + '円'; }
    function fmtAt(n)      { return '@' + (Number(n) || 0).toLocaleString('ja-JP'); }
    function fmtYenMark(n) { return '¥' + (Number(n) || 0).toLocaleString('ja-JP'); }
    function fmtNum(n)     { return (Number(n) || 0).toLocaleString('ja-JP'); }

    function fmtQty(it) {
      const unit = (it.unit || '').trim();
      const qty  = Number(it.quantity) || 1;
      if (unit === '式' || unit === '一式') return '一式';
      const slash = unit.indexOf('/');
      if (slash === -1) return qty + esc(unit);
      const leftUnit  = unit.substring(0, slash).trim();
      const rightUnit = unit.substring(slash + 1).trim();
      const count     = leftUnit === '名' ? interpreters : qty;
      if (rightUnit === '半日') return count + leftUnit + '×半日';
      if (rightUnit === '日')   return count + leftUnit + '×' + numDays + '日';
      if (rightUnit === '時間') return count + leftUnit + '×' + qty + '時間';
      if (rightUnit === '回')   return qty + leftUnit + '×' + qty + '回';
      return qty + esc(unit);
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
        text = '同時通訳機器レンタル（' + (d.projectName ? esc(d.projectName) : '') + '）業務';
      } else {
        const langPart = langs ? '　' + langs + '　' : '　';
        text = d.projectName
          ? esc(d.projectName) + langPart + '同時通訳業務'
          : '同時通訳業務';
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

      const overtimeUnit = 7000;
      let overtimeFee = 0;
      let overtimeRow = '';
      if (workingHours > 8) {
        const extraHours   = workingHours - 8;
        const extra05Units = Math.ceil(extraHours / 0.5);
        const extraHrsVal  = extra05Units * 0.5;
        overtimeFee = overtimeUnit * interpreters * extra05Units;
        const overN = rowNum++;
        overtimeRow = '<tr>'
          + '<td class="td-name">' + overN + ')&ensp;延長料</td>'
          + '<td class="td-price">' + fmtAt(overtimeUnit) + '</td>'
          + '<td class="td-qty">' + interpreters + '名×' + extraHrsVal + '時間</td>'
          + '<td class="td-sub">' + fmtYen(overtimeFee) + '</td>'
          + '</tr>';
      }

      const mgmtBase = interpFeeTotal + overtimeFee;
      const mgmtFee  = Math.round(mgmtBase * 0.1);
      const mgmtNum  = rowNum++;

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
        + '<tr>'
        + '<td class="td-name">' + mgmtNum + ')&ensp;管理費</td>'
        + '<td class="td-price td-note">上記通訳料合計の10%</td>'
        + '<td class="td-qty"></td>'
        + '<td class="td-sub">' + fmtYen(mgmtFee) + '</td>'
        + '</tr>'
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
        + '<tr><td>納入日</td><td>：</td><td>' + (d.eventDate ? esc(d.eventDate) : '「項目」欄を参照') + '</td></tr>'
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
        return s + Math.max(1, Number(it.quantity) || 1) * numDays * (Number(it.unitPrice) || 0);
      }, 0);
      const discountedTotal = Math.max(0, equipTotal - discount);
      const tax   = isTaxExempt ? 0 : Math.round(discountedTotal * 0.1);
      const grand = discountedTotal + tax;

      const discountRow = discount > 0
        ? '<tr><td class="td-name">お値引き</td><td></td><td></td><td class="td-sub">▲' + fmtYen(discount) + '</td></tr>'
        : '<tr><td class="td-name">4)</td><td></td><td></td><td></td></tr>';

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
        + '<tr><td class="td-name">2)</td><td></td><td></td><td></td></tr>'
        + '<tr><td class="td-name">3)</td><td></td><td></td><td></td></tr>'
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
        + '<tr><td>納入日</td><td>：</td><td>' + (d.eventDate ? esc(d.eventDate) : '「同時通訳機器レンタル費用など明細」参照') + '</td></tr>'
        + '<tr><td>納入場所</td><td>：</td><td>' + (locStr ? esc(locStr) : '「同時通訳機器レンタル費用など明細」参照') + '</td></tr>'
        + '<tr><td>お支払</td><td>：</td><td>請求日より30日以内銀行振込</td></tr>'
        + '</table></div>'
        + '</div>';
    }

    function buildEquipDetailPage() {
      let detailTotal = 0;
      let detailRows = '';
      equipItems.forEach(function(it) {
        if (it.venueEquipment) {
          detailRows += '<tr>'
            + '<td class="td-name">' + esc(it.name) + '</td>'
            + '<td class="td-center venue-equip" colspan="3">会場常設を使用</td>'
            + '<td class="td-right">0</td>'
            + '</tr>';
        } else {
          const qty    = Math.max(1, Number(it.quantity) || 1);
          const amount = qty * numDays * (Number(it.unitPrice) || 0);
          detailTotal += amount;
          detailRows += '<tr>'
            + '<td class="td-name">' + esc(it.name) + '</td>'
            + '<td class="td-center">' + qty + '</td>'
            + '<td class="td-center">' + numDays + '</td>'
            + '<td class="td-right">' + fmtYenMark(it.unitPrice) + '</td>'
            + '<td class="td-right">' + fmtNum(amount) + '</td>'
            + '</tr>';
        }
      });

      return '<div class="page">'
        + '<div class="detail-title-box">同時通訳機器レンタル費用など明細</div>'
        + '<div class="addr-row">'
        + '<div class="customer-block">' + customer + '</div>'
        + '<div class="sender-block">'
        + '〒150-0047　東京都渋谷区神山町 5-5<br>'
        + 'Tel:03-5453-8458　Fax:03-5453-3485'
        + '</div>'
        + '</div>'
        + '<table class="info-tbl">'
        + '<tr><td class="info-label">件　　　名</td><td class="info-sep">：</td><td class="info-val">' + (d.projectName ? esc(d.projectName) : '') + '</td></tr>'
        + '<tr><td class="info-label">納　入　日</td><td class="info-sep">：</td><td class="info-val">' + (d.eventDate ? esc(d.eventDate) : '') + '</td></tr>'
        + '<tr><td class="info-label">納入場所</td><td class="info-sep">：</td><td class="info-val">' + (locStr ? esc(locStr) : '') + '</td></tr>'
        + '<tr><td class="info-label">設　　　営</td><td class="info-sep">：</td><td class="info-val">前日</td></tr>'
        + '<tr><td class="info-label">撤　　　去</td><td class="info-sep">：</td><td class="info-val">終了後</td></tr>'
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
        + '<tr>'
        + '<td colspan="3" style="border:1px solid #000; border-top:2px solid #000; text-align:center; font-weight:bold; font-size:11pt; white-space:nowrap;">合　計　金　額</td>'
        + '<td style="border:1px solid #000; border-top:2px solid #000;"></td>'
        + '<td class="td-right" style="border:1px solid #000; border-top:2px solid #000; font-weight:bold; font-size:11pt;">' + fmtYen(detailTotal) + '</td>'
        + '</tr>'
        + '</tbody></table>'
        + '<div class="notes-block">'
        + '<p>合計金額に消費税は含まれていません。</p>'
        + '<p>レシーバー（FM無線受信機）紛失の際には、補償費を申し受けます（38,000円/1台）。</p>'
        + '</div>'
        + '</div>';
    }

    let bodyContent;
    if (d.type === 'both') {
      bodyContent = buildInterpPage() + buildEquipSummaryPage() + buildEquipDetailPage();
    } else if (d.type === 'equipment') {
      bodyContent = buildEquipSummaryPage() + buildEquipDetailPage();
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
      '.detail-title-box { text-align: center; font-size: 14pt; font-weight: bold; border: 2px solid #000; padding: 7px 0; margin-bottom: 15px; letter-spacing: 0.05em; }',
      '.info-tbl { border-collapse: collapse; width: 100%; margin: 0 0 15px; font-size: 10pt; }',
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
  });

})();
