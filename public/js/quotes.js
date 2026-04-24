(function () {
  const token = window.authUtils ? window.authUtils.getToken() : '';
  if (!token) {
    location.href = '/login.html';
    return;
  }

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
  function addItemRow(tbody, item) {
    item = item || { name: '', quantity: 1, unit: '式', unitPrice: 0 };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-name"><input type="text"   value="${esc(item.name)}"                  placeholder="品名" /></td>
      <td><input type="number" value="${Number(item.quantity) || 1}" min="0" style="width:70px;" /></td>
      <td><input type="text"   value="${esc(item.unit || '式')}"        style="width:50px;" /></td>
      <td><input type="number" value="${Number(item.unitPrice) || 0}"  min="0" step="100" /></td>
      <td class="td-sub">${fmt(calcSubtotal(item.quantity, item.unitPrice))}</td>
      <td class="td-del"><button class="del-btn" type="button" title="削除">×</button></td>
    `;
    const inputs = tr.querySelectorAll('input');
    const qtyIn   = inputs[1];
    const priceIn = inputs[3];
    function updateSub() {
      tr.querySelector('.td-sub').textContent = fmt(calcSubtotal(qtyIn.value, priceIn.value));
      recalcTotal();
    }
    qtyIn.addEventListener('input', updateSub);
    priceIn.addEventListener('input', updateSub);
    tr.querySelector('.del-btn').addEventListener('click', () => { tr.remove(); recalcTotal(); });
    tbody.appendChild(tr);
  }

  function renderTable(tbody, items) {
    tbody.innerHTML = '';
    (items || []).forEach(item => addItemRow(tbody, item));
  }

  // ── 合計を再計算 ──────────────────────────────────────────
  function recalcTotal() {
    let total = 0;
    function sumTable(tbody) {
      tbody.querySelectorAll('tr').forEach(tr => {
        const inputs = tr.querySelectorAll('input');
        if (inputs.length < 4) return;
        const sub = calcSubtotal(inputs[1].value, inputs[3].value);
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
      const inputs = tr.querySelectorAll('input');
      if (inputs.length < 4) return;
      items.push({
        name:      inputs[0].value,
        quantity:  Number(inputs[1].value) || 0,
        unit:      inputs[2].value,
        unitPrice: Number(inputs[3].value) || 0,
        subtotal:  calcSubtotal(inputs[1].value, inputs[3].value),
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

      renderTable(interpBody, data.interpretationItems || []);
      renderTable(equipBody,  data.equipmentItems      || []);
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
  addInterpBtn.addEventListener('click', () => addItemRow(interpBody, null));
  addEquipBtn.addEventListener('click',  () => addItemRow(equipBody,  null));

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
    const d            = collectData();
    const locStr       = d.location;
    const interpreters = d.interpreters;
    const discount     = d.discount;
    const isOutsideTokyo = d.outsideTokyo;
    const interpItems  = d.interpretationItems;
    const equipItems   = d.equipmentItems;
    const numDays      = d.numDays;
    const isTaxExempt  = d.isTaxExempt ||
      /国連|UN\b|UNESCO|WHO|UNDP|UNICEF|WFP|ILO|IMF|OECD|世界銀行/i.test(d.customerName || '');

    const now = new Date();
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

    function fmtQty(it) {
      const unit = (it.unit || '').trim();
      const qty  = Number(it.quantity) || 1;
      if (unit === '式' || unit === '一式') return '一式';
      const slash = unit.indexOf('/');
      if (slash === -1) return `${qty}${esc(unit)}`;
      const leftUnit  = unit.substring(0, slash).trim();
      const rightUnit = unit.substring(slash + 1).trim();
      const count     = leftUnit === '名' ? interpreters : qty;
      if (rightUnit === '半日') return `${count}${leftUnit}×半日`;
      if (rightUnit === '日')   return `${count}${leftUnit}×${numDays}日`;
      if (rightUnit === '時間') return `${count}${leftUnit}×${qty}時間`;
      if (rightUnit === '回')   return `${qty}${leftUnit}×${qty}回`;
      return `${qty}${esc(unit)}`;
    }

    function headerHTML() {
      const customer = d.customerName
        ? esc(d.customerName) + '　御中'
        : '　　　　　　　　　　御中';
      return `
        <div class="date-row">${dateStr}</div>
        <div class="addr-row">
          <div class="customer-block">${customer}</div>
          <div class="sender-block">
            <img src="/images/logo.png" style="height:50px; display:block; margin-bottom:4px;">
            株式会社 NHKグローバルメディアサービス<br>
            国際事業センター<br>
            〒150-0047　東京都渋谷区神山町5-5<br>
            TEL:03-5453-8458　FAX:03-5453-3485
          </div>
        </div>`;
    }

    function subjectHTML(pageType) {
      const langs = (Array.isArray(d.languages) && d.languages.length > 0)
        ? d.languages.join('・') : '';
      let text;
      if (pageType === 'equipment') {
        text = `同時通訳機器レンタル（${d.projectName ? esc(d.projectName) : ''}）業務`;
      } else {
        const langPart = langs ? `　${langs}　` : '　';
        text = d.projectName
          ? `${esc(d.projectName)}${langPart}同時通訳業務`
          : '同時通訳業務';
      }
      return `
        <div class="subject-row">
          <span class="subject-label">件　名　：</span>
          <span class="subject-text">${text}</span>
        </div>`;
    }

    function buildInterpPage() {
      let rowNum = 1;
      const itemRows = interpItems.map(it => {
        const n = rowNum++;
        return `
          <tr>
            <td class="td-name">${n})&ensp;${esc(it.name)}</td>
            <td class="td-price">${fmt(it.unitPrice)}</td>
            <td class="td-qty">${fmtQty(it)}</td>
            <td class="td-sub">${fmt(it.subtotal)}</td>
          </tr>`;
      }).join('');

      const interpFeeTotal = interpItems.reduce((s, it) => s + it.subtotal, 0);
      const mgmtFee        = Math.round(interpFeeTotal * 0.1);
      const travelUnit     = 28000;
      const dailyUnit      = 8000;
      const travelTotal    = travelUnit * interpreters * numDays;
      const dailyTotal     = dailyUnit  * interpreters * numDays;
      const qtyStr         = `${interpreters}名×${numDays}日`;
      const mgmtNum        = rowNum++;

      let travelRows = '';
      if (isOutsideTokyo) {
        const tN = rowNum++, dN = rowNum++;
        travelRows = `
          <tr>
            <td class="td-name">${tN})&ensp;移動拘束費</td>
            <td class="td-price">${fmt(travelUnit)}</td>
            <td class="td-qty">${qtyStr}</td>
            <td class="td-sub">${fmt(travelTotal)}</td>
          </tr>
          <tr>
            <td class="td-name">${dN})&ensp;日当</td>
            <td class="td-price">${fmt(dailyUnit)}</td>
            <td class="td-qty">${qtyStr}</td>
            <td class="td-sub">${fmt(dailyTotal)}</td>
          </tr>`;
      }

      const totalBeforeTax = interpFeeTotal + mgmtFee
        + (isOutsideTokyo ? travelTotal + dailyTotal : 0);
      const tax   = isTaxExempt ? 0 : Math.round(totalBeforeTax * 0.1);
      const grand = totalBeforeTax + tax;

      return `
      <div class="page">
        ${headerHTML()}
        <div class="main-title">御　見　積　書</div>
        ${subjectHTML('interpretation')}
        <table class="items-tbl">
          <thead>
            <tr>
              <th class="th-name">項　目</th>
              <th class="th-price">単　価</th>
              <th class="th-qty">数　量</th>
              <th class="th-sub">小　計</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
            <tr>
              <td class="td-name">${mgmtNum})&ensp;上記通訳料の10%（管理費）</td>
              <td class="td-price"></td>
              <td class="td-qty">一式</td>
              <td class="td-sub">${fmt(mgmtFee)}</td>
            </tr>
            ${travelRows}
            <tr class="empty-row"><td class="td-name">&nbsp;</td><td></td><td></td><td></td></tr>
            <tr class="empty-row"><td class="td-name">&nbsp;</td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div class="totals-wrap">
          <table class="totals-tbl">
            <tr><td class="tl">小　計</td><td class="tr">${fmt(totalBeforeTax)}</td></tr>
            <tr><td class="tl">消費税（10%）</td><td class="tr">${isTaxExempt ? '免税' : fmt(tax)}</td></tr>
            <tr class="grand-row"><td class="tl">合　計　${isTaxExempt ? '' : '＊'}</td><td class="tr">${fmt(grand)}</td></tr>
          </table>
        </div>
        <div class="notes-block">
          ${!isTaxExempt ? '<p class="star-note">＊は消費税額を含む金額であることを示します</p>' : ''}
          <table class="notes-tbl">
            <tr><td>納入日</td><td>：</td><td>「項目」欄を参照</td></tr>
            <tr><td>納入場所</td><td>：</td><td>☆☆☆☆☆本社</td></tr>
            <tr><td>お支払</td><td>：</td><td>請求日より30日以内銀行振込</td></tr>
          </table>
          <ul class="notes-list">
            <li>通訳料半日とは、午前または午後4時間以内の拘束（実働3時間以内）を意味します</li>
            <li>通訳料1日とは、4時間以上8時間以内の拘束（休憩含む）を意味します</li>
            <li>通訳料のオーバータイムは、7,000円／0.5hとなります</li>
            <li>通訳料のキャンセルは、当日・前日100％、2～3日前50％、4～7日前30％</li>
          </ul>
        </div>
      </div>`;
    }

    function buildEquipSummaryPage() {
      const equipTotal = equipItems.reduce((s, it) => {
        return s + Math.max(1, Number(it.quantity) || 1) * numDays * (Number(it.unitPrice) || 0);
      }, 0);
      const discountedTotal = Math.max(0, equipTotal - discount);
      const tax   = isTaxExempt ? 0 : Math.round(discountedTotal * 0.1);
      const grand = discountedTotal + tax;

      return `
      <div class="page">
        ${headerHTML()}
        <div class="main-title">御　見　積　書</div>
        ${subjectHTML('equipment')}
        <table class="items-tbl">
          <thead>
            <tr>
              <th class="th-name">項　目</th>
              <th class="th-price">単　価</th>
              <th class="th-qty">数　量</th>
              <th class="th-sub">小　計</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="td-name">1)&ensp;同時通訳機器レンタル費用など</td>
              <td class="td-price td-center">明細参照</td>
              <td class="td-qty">一式</td>
              <td class="td-sub">${fmt(equipTotal)}</td>
            </tr>
            <tr><td class="td-name">2)</td><td></td><td></td><td></td></tr>
            <tr><td class="td-name">3)</td><td></td><td></td><td></td></tr>
            <tr><td class="td-name">4)</td><td></td><td></td><td></td></tr>
            <tr>
              <td class="td-name">お値引き</td>
              <td class="td-price"></td>
              <td class="td-qty"></td>
              <td class="td-sub">${discount > 0 ? '▲' + fmt(discount) : '¥0'}</td>
            </tr>
            <tr class="empty-row"><td class="td-name">&nbsp;</td><td></td><td></td><td></td></tr>
            <tr class="empty-row"><td class="td-name">&nbsp;</td><td></td><td></td><td></td></tr>
          </tbody>
        </table>
        <div class="totals-wrap">
          <table class="totals-tbl">
            <tr><td class="tl">小　計</td><td class="tr">${fmt(discountedTotal)}</td></tr>
            <tr><td class="tl">消費税（10%）</td><td class="tr">${isTaxExempt ? '免税' : fmt(tax)}</td></tr>
            <tr class="grand-row"><td class="tl">合　計　${isTaxExempt ? '' : '＊'}</td><td class="tr">${fmt(grand)}</td></tr>
          </table>
        </div>
        <div class="notes-block">
          ${!isTaxExempt ? '<p class="star-note">＊は消費税額を含む金額であることを示します</p>' : ''}
          <table class="notes-tbl">
            <tr><td>納入日</td><td>：</td><td>${d.eventDate ? esc(d.eventDate) : '「同時通訳機器レンタル費用など明細」参照'}</td></tr>
            <tr><td>納入場所</td><td>：</td><td>${locStr ? esc(locStr) : '「同時通訳機器レンタル費用など明細」参照'}</td></tr>
            <tr><td>お支払</td><td>：</td><td>請求日より30日以内銀行振込</td></tr>
          </table>
        </div>
      </div>`;
    }

    function buildEquipDetailPage() {
      const detailRows = equipItems.map(it => {
        const qty    = Math.max(1, Number(it.quantity) || 1);
        const amount = qty * numDays * (Number(it.unitPrice) || 0);
        return `
        <tr>
          <td class="td-name">${esc(it.name)}</td>
          <td class="td-center">${qty}</td>
          <td class="td-center">${numDays}</td>
          <td class="td-right">${fmt(it.unitPrice)}</td>
          <td class="td-right">${fmt(amount)}</td>
          <td class="td-center"></td>
        </tr>`;
      }).join('');

      const equipTotal = equipItems.reduce((s, it) => {
        return s + Math.max(1, Number(it.quantity) || 1) * numDays * (Number(it.unitPrice) || 0);
      }, 0);

      return `
      <div class="page">
        ${headerHTML()}
        <div class="detail-title-box">同時通訳装置レンタル費用明細</div>
        <table class="info-tbl">
          <tr><td class="info-label">会　議　名</td><td class="info-sep">：</td><td class="info-val">${d.projectName ? esc(d.projectName) : ''}</td></tr>
          <tr><td class="info-label">年　月　日</td><td class="info-sep">：</td><td class="info-val">${d.eventDate ? esc(d.eventDate) : ''}</td></tr>
          <tr><td class="info-label">場　　　所</td><td class="info-sep">：</td><td class="info-val">${locStr ? esc(locStr) : ''}</td></tr>
          <tr><td class="info-label">設　　　営</td><td class="info-sep">：</td><td class="info-val">前日</td></tr>
          <tr><td class="info-label">撤　　　去</td><td class="info-sep">：</td><td class="info-val">終了後</td></tr>
          <tr><td class="info-label">録　　　音</td><td class="info-sep">：</td><td class="info-val">無</td></tr>
        </table>
        <table class="items-tbl detail-tbl">
          <thead>
            <tr>
              <th class="th-name">項　目</th>
              <th class="th-center">台数</th>
              <th class="th-center">日数</th>
              <th class="th-right">単　価</th>
              <th class="th-right">金　額</th>
              <th class="th-center">備　考</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows}
            <tr class="detail-total-row">
              <td colspan="3" class="td-name">合　計　金　額</td>
              <td colspan="2" class="td-right">${fmt(equipTotal)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <div class="notes-block">
          <p>※合計金額には、消費税は含まれていません。</p>
          <p>※レシーバー（FM無線受信機）紛失の際には補償費を申し受けます（38,000円/1台）</p>
        </div>
      </div>`;
    }

    let bodyContent;
    if (d.type === 'both') {
      bodyContent = buildInterpPage() + buildEquipSummaryPage() + buildEquipDetailPage();
    } else if (d.type === 'equipment') {
      bodyContent = buildEquipSummaryPage() + buildEquipDetailPage();
    } else {
      bodyContent = buildInterpPage();
    }

    const css = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: "MS Mincho", "Yu Mincho", "Hiragino Mincho ProN", "HiraMinProN-W3", serif;
        font-size: 10.5pt; color: #000; background: #fff;
      }
      .page { width: 210mm; min-height: 297mm; padding: 40mm 25mm; }
      .date-row { text-align: right; margin-bottom: 16px; font-size: 10pt; }
      .addr-row { display: flex; justify-content: space-between; align-items: flex-start; min-height: 120px; margin-bottom: 32px; }
      .customer-block { font-size: 14pt; font-weight: bold; }
      .sender-block   { text-align: right; line-height: 1.8; font-size: 9pt; }
      .main-title { text-align: center; font-size: 20pt; font-weight: bold; margin-top: 30px; margin-bottom: 15px; letter-spacing: 0.15em; }
      .detail-title-box { text-align: center; font-size: 14pt; font-weight: bold; border: 2px solid #000; padding: 7px 0; margin: 30px 0 15px; letter-spacing: 0.05em; }
      .info-tbl { border-collapse: collapse; width: auto; margin: 0 0 15px; font-size: 10pt; }
      .info-tbl td { border: 1px solid #000; padding: 3px 8px; text-align: left; }
      .info-label { font-weight: bold; white-space: nowrap; }
      .info-sep   { text-align: left; white-space: nowrap; }
      .info-val   { min-width: 200px; }
      .subject-row { display: flex; justify-content: center; align-items: baseline; font-size: 10.5pt; margin-top: 0; margin-bottom: 20px; }
      .subject-label { white-space: nowrap; }
      .subject-text  { border-bottom: 1px solid #000; padding: 0 16px 2px; min-width: 60px; }
      .items-tbl { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 0; }
      .items-tbl th, .items-tbl td { border: 1px solid #000; padding: 5px 8px; font-size: 10pt; }
      .items-tbl th { text-align: center; font-weight: bold; }
      .th-name  { width: 50%; }
      .th-price { width: 15%; }
      .th-qty   { width: 15%; }
      .th-sub   { width: 20%; }
      .th-center { text-align: center; }
      .th-right  { text-align: right; }
      .detail-tbl th:nth-child(1) { width: 30%; }
      .detail-tbl th:nth-child(2) { width: 10%; }
      .detail-tbl th:nth-child(3) { width: 10%; }
      .detail-tbl th:nth-child(4) { width: 17%; }
      .detail-tbl th:nth-child(5) { width: 23%; }
      .detail-tbl th:nth-child(6) { width: 10%; }
      .detail-tbl th, .detail-tbl td { padding: 4px 6px; white-space: nowrap; }
      .detail-tbl .td-name { white-space: normal; }
      .empty-row td { height: 24px; }
      .detail-total-row td { border-top: 2px solid #000; font-weight: bold; font-size: 11pt; }
      .td-name   { text-align: left; }
      .td-price  { text-align: right; }
      .td-qty    { text-align: right; white-space: nowrap; min-width: 100px; font-size: 0.9em; }
      .td-sub    { text-align: right; }
      .td-center { text-align: center; }
      .td-right  { text-align: right; }
      .totals-wrap { margin: 10px 0 16px; }
      .totals-tbl  { border-collapse: collapse; width: 35%; margin-left: auto; }
      .totals-tbl td { border: 1px solid #000; padding: 4px 10px; font-size: 10pt; }
      .totals-tbl .tl { text-align: left; white-space: nowrap; }
      .totals-tbl .tr { text-align: right; }
      .grand-row td   { font-weight: bold; font-size: 11pt; }
      .notes-block { margin-top: 20px; font-size: 9pt; }
      .star-note   { margin-bottom: 8px; }
      .notes-tbl   { border-collapse: collapse; margin-bottom: 10px; font-size: 0.85em; }
      .notes-tbl td { padding: 2px 6px; vertical-align: top; }
      .notes-tbl td:first-child { white-space: nowrap; }
      .notes-list  { list-style: none; padding-left: 0; }
      .notes-list li { margin-bottom: 3px; }
      .notes-list li::before { content: "・"; }
      @page { size: A4; margin: 0; }
      @media print {
        body { margin: 25mm 20mm 20mm 20mm; }
        .page { padding: 0; width: auto; min-height: auto; page-break-after: always; }
        .page:last-child { page-break-after: avoid; }
      }
    `;

    const html = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title></title><style>${css}</style></head>
<body>${bodyContent}</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.document.title = '';
      if (win.document.readyState === 'complete') win.print();
      else win.addEventListener('load', () => win.print());
    } else {
      showError('ポップアップがブロックされました。ブラウザの設定を確認してください。');
    }
  });

})();
