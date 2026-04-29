const express = require("express");
const Groq = require("groq-sdk");
const pool   = require("../db");
const auth   = require("../middleware/auth");

const router = express.Router();
const priceMaster = require("../data/price-master.json");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// テーブルが存在しない場合は作成
pool.query(`
  CREATE TABLE IF NOT EXISTS quotes (
    id           SERIAL PRIMARY KEY,
    type         VARCHAR(20) NOT NULL,
    customer_name TEXT,
    project_name  TEXT,
    event_date    TEXT,
    items         JSONB NOT NULL DEFAULT '[]',
    total_amount  INTEGER NOT NULL DEFAULT 0,
    raw_email     TEXT,
    created_by    INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(err => console.error("quotes table creation error:", err));

// ── POST /api/quotes/analyze ────────────────────────────────
router.post("/analyze", auth, async (req, res) => {
  try {
    const { emailText } = req.body;
    if (!emailText || typeof emailText !== "string" || !emailText.trim()) {
      return res.status(400).json({ message: "emailText is required" });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ message: "GROQ_API_KEY is not configured" });
    }

    const prompt = `
あなたは通訳・映像機材レンタル会社の見積書作成アシスタントです。
以下のメール本文を解析し、見積書に必要な情報をJSON形式で抽出してください。

【価格マスタ】
${JSON.stringify(priceMaster, null, 2)}

【メール本文】
${emailText}

【項目分類ルール（重要）】
■ interpretationItems（通訳見積書）に含める項目：
- 同時通訳料（英語・中国語・フランス語など言語別。拘束時間が4時間以内なら「半日」、4〜8時間なら「1日」を選択）
- 通訳音声二次使用料（依頼がある場合のみ）
※延長料・移動拘束費・日当・管理費はシステムが自動計算するため含めない

■ equipmentItems（機材見積書）に含める項目：
- 同時通訳機器類（通訳ユニット・ブース・受信機・送信機など）
- 音響機器（ミキサー・マイク・スピーカーなど）
- 映像機器（カメラ・モニターなど）
- オンライン機器（PC・インターフェースなど）
- エンジニア・技術者費用
- 設営・撤去費
- 運搬費

■ 絶対に重複させない：同じ項目がinterpretationItemsとequipmentItemsの両方に入らないこと。
  通訳ブース・受信機などは必ずequipmentItemsのみ。
  通訳料は必ずinterpretationItemsのみ。

【出張判定ルール】
- 渋谷から100km以上 OR 新幹線・飛行機が必要な場合 → outsideTokyo: true
- 東京都内・神奈川・埼玉・千葉などの近郊 → outsideTokyo: false
- 大阪・名古屋・福岡・沖縄・札幌・広島・仙台などの遠方 → outsideTokyo: true

【travelPattern の判定】
- "none"     : 出張なし（outsideTokyo: false）または移動情報が不明
- "dayTrip"  : 当日移動・当日帰宅の日帰り出張
- "sameDay"  : 当日移動・宿泊あり・翌日帰京
- "preDay"   : 前日入り・宿泊あり（前日入り明記、または大阪・福岡・札幌・沖縄など遠方で前日入りが一般的な場合）

【拘束時間の算出】
- 開始時刻〜終了時刻が記載されていれば workingHours を算出（小数可、例: 9.5）
- 不明な場合は 0

【出力フォーマット（JSONのみ返すこと）】
{
  "type": "interpretation" | "equipment" | "both" | "english",
  "customerName": "顧客名（不明な場合は null）",
  "projectName": "案件名・イベント名（不明な場合は null）",
  "eventDate": "日程（例: 2025年3月15日、不明な場合は null）",
  "startTime": "開始時刻（例：13:00、不明な場合は null）",
  "endTime": "終了時刻（例：17:00、不明な場合は null）",
  "location": "開催都市名（例: 大阪、福岡、不明な場合は null）",
  "outsideTokyo": 出張判定ルールに基づき true / false,
  "requiresStay": 宿泊が必要な場合は true、日帰りまたは不明は false,
  "preDayEntry": 前日入りが必要または明記されている場合は true、それ以外は false,
  "workingHours": 拘束時間（数値、不明な場合は 0）,
  "travelPattern": "none" | "dayTrip" | "sameDay" | "preDay",
  "transportRoute": "交通手段の経路（例: 羽田空港－那覇空港、東京駅－新大阪駅（新幹線））、不明な場合は null",
  "interpreters": 通訳者数（数値、不明な場合は 1）,
  "languages": ["言語ペア（例: 日本語-英語, 日本語-中国語, 日本語-フランス語）（不明な場合は []）"],
  "languageCount": 言語ペア数（整数。日英のみなら 1、日英と日仏の2言語なら 2。不明な場合は 1）,
  "numDays": イベント日数（数値、不明な場合は 1）,
  "interpretationItems": [
    {
      "id": "価格マスタのid（不明な場合は null）",
      "name": "品目名",
      "quantity": 数量（数値）,
      "unitPrice": 単価（価格マスタから取得、不明な場合は 0）,
      "unit": "単位",
      "subtotal": 小計（quantity × unitPrice）
    }
  ],
  "equipmentItems": [
    {
      "id": "価格マスタのid（不明な場合は null）",
      "name": "品目名",
      "quantity": 数量（数値）,
      "unitPrice": 単価（価格マスタから取得、不明な場合は 0）,
      "unit": "単位",
      "subtotal": 小計（quantity × unitPrice）
    }
  ],
  "discount": 値引き額（数値、なければ 0）,
  "totalAmount": 合計金額（数値）,
  "notes": "その他の備考（不明な場合は null）"
}

type の判定基準：
- 通訳のみ → "interpretation"
- 機材のみ → "equipment"
- 両方 → "both"
- 英語メール → "english"

JSONのみ返してください。マークダウンのコードブロックは不要です。
    `.trim();

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";

    let quoteData;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      quoteData = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ message: "Groq response parse error", raw: text });
    }

    return res.json(quoteData);
  } catch (err) {
    console.error("POST /quotes/analyze error:", err);
    return res.status(500).json({ message: "Failed to analyze email" });
  }
});

// ── POST /api/quotes/save ───────────────────────────────────
router.post("/save", auth, async (req, res) => {
  try {
    const { type, customerName, projectName, eventDate, items, totalAmount, rawEmail } = req.body;

    if (!type) {
      return res.status(400).json({ message: "type is required" });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "items must be an array" });
    }

    const result = await pool.query(
      `INSERT INTO quotes (type, customer_name, project_name, event_date, items, total_amount, raw_email, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        type,
        customerName || null,
        projectName  || null,
        eventDate    || null,
        JSON.stringify(items),
        totalAmount  || 0,
        rawEmail     || null,
        req.user.id,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /quotes/save error:", err);
    return res.status(500).json({ message: "Failed to save quote" });
  }
});

// ── POST /api/quotes/export/excel ──────────────────────────────
router.post("/export/excel", auth, async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const {
      type = "both",
      customerName = "",
      projectName  = "",
      eventDate    = "",
      location     = "",
      interpretationItems = [],
      equipmentItems      = [],
      studioItems         = null,
      localItems          = null,
      isSplitMode         = false,
      discount     = 0,
      numDays      = 1,
      interpreters = 1,
      outsideTokyo  = false,
      isTaxExempt   = false,
      languages     = [],
      travelPattern  = "none",
      workingHours   = 0,
      requiresStay   = false,
      transportRoute = "",
    } = req.body;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "NHK Global Media Services";
    workbook.created = new Date();

    const now = new Date();
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const FONT_NAME = "MS Mincho";
    const THIN = { style: "thin" };
    const BORDER_ALL = { top: THIN, left: THIN, bottom: THIN, right: THIN };

    function numVal(n) { return Number(n) || 0; }
    function setFont(cell, size = 10, bold = false) {
      cell.font = { name: FONT_NAME, size, bold };
    }
    function setBorder(cell) { cell.border = BORDER_ALL; }
    function setRight(cell)  { cell.alignment = { horizontal: "right" }; }
    function setCenter(cell) { cell.alignment = { horizontal: "center" }; }
    function setMoney(cell)  { cell.numFmt = "#,##0"; }

    function buildHeader(ws, titleSuffix) {
      // 日付
      ws.getCell("D1").value = dateStr;
      setFont(ws.getCell("D1"), 10); setRight(ws.getCell("D1"));
      // 顧客名
      ws.getCell("A2").value = (customerName || "") + "　御中";
      setFont(ws.getCell("A2"), 14, true);
      // 自社情報
      ws.getCell("D3").value = "〒150-0047　東京都渋谷区神山町5-5";
      ws.getCell("D4").value = "株式会社 NHKグローバルメディアサービス";
      ws.getCell("D5").value = "国際事業センター";
      [3,4,5].forEach(r => setFont(ws.getCell(`D${r}`), 9));
      // タイトル
      ws.mergeCells("A7:D7");
      ws.getCell("A7").value = "御　見　積　書（" + titleSuffix + "）";
      setFont(ws.getCell("A7"), 16, true);
      ws.getCell("A7").alignment = { horizontal: "center" };
    }

    function addItemsHeader(ws, rowNum) {
      const hRow = ws.getRow(rowNum);
      ["項　目", "単　価", "数　量", "小　計"].forEach((h, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = h; setCenter(cell);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        setFont(cell, 10, true); setBorder(cell);
      });
      return rowNum + 1;
    }

    function addTotals(ws, rowNum, subtotal, tax, grand, taxLabel) {
      const rows = [
        ["小　計",       subtotal],
        [taxLabel,       tax === 0 && taxLabel.includes("免税") ? "免税" : tax],
        ["合　計",       grand],
      ];
      rows.forEach(([label, val], i) => {
        ws.mergeCells(`A${rowNum}:C${rowNum}`);
        const labelCell = ws.getCell(`A${rowNum}`);
        const valCell   = ws.getCell(`D${rowNum}`);
        labelCell.value = label; setRight(labelCell);
        valCell.value = val; setRight(valCell);
        const bold = label === "合　計";
        [labelCell, valCell].forEach(c => { setFont(c, bold ? 11 : 10, bold); setBorder(c); });
        if (typeof val === "number") setMoney(valCell);
        rowNum++;
      });
      return rowNum;
    }

    // ── 通訳シート ──────────────────────────────────────────────
    if (type === "interpretation" || type === "both" || type === "english") {
      const ws = workbook.addWorksheet("通訳");
      ws.columns = [
        { width: 42 }, { width: 14 }, { width: 12 }, { width: 18 },
      ];

      buildHeader(ws, "通訳費用など");

      // 件名
      const langs = Array.isArray(languages) && languages.length > 0
        ? languages.join("・") : "";
      const subj = projectName
        ? `${projectName}${langs ? "　" + langs + "　" : "　"}同時通訳業務`
        : "同時通訳業務";
      ws.getCell("A8").value = "件名：" + subj;
      setFont(ws.getCell("A8"), 10);

      let r = addItemsHeader(ws, 10);

      const items = Array.isArray(interpretationItems) ? interpretationItems : [];
      items.forEach((it, idx) => {
        const row = ws.getRow(r++);
        row.getCell(1).value = `${idx + 1})　${it.name || ""}`;
        row.getCell(2).value = numVal(it.unitPrice);
        row.getCell(3).value = it.unit || "式";
        row.getCell(4).value = numVal(it.subtotal);
        [1,2,3,4].forEach(c => { setFont(row.getCell(c), 10); setBorder(row.getCell(c)); });
        setRight(row.getCell(2)); setMoney(row.getCell(2));
        setRight(row.getCell(4)); setMoney(row.getCell(4));
      });

      // 延長料 (workingHoursベース)
      const interpFeeTotal = items.reduce((s, it) => s + numVal(it.subtotal), 0);
      const overtimeUnit = 7000;
      let overtimeFee = 0;
      let extraIdx = items.length + 1;

      if (numVal(workingHours) > 8) {
        const extraHours   = numVal(workingHours) - 8;
        const extra05Units = Math.ceil(extraHours / 0.5);
        const extraHrsStr  = (extra05Units * 0.5) % 1 === 0
          ? `${extra05Units * 0.5}時間` : `${extra05Units * 0.5}時間`;
        overtimeFee = overtimeUnit * numVal(interpreters) * extra05Units;
        const overRow = ws.getRow(r++);
        overRow.getCell(1).value = `${extraIdx})　延長料`;
        overRow.getCell(2).value = overtimeUnit;
        overRow.getCell(3).value = `${interpreters}名×${extraHrsStr}`;
        overRow.getCell(4).value = overtimeFee;
        [1,2,3,4].forEach(c => { setFont(overRow.getCell(c), 10); setBorder(overRow.getCell(c)); });
        setRight(overRow.getCell(2)); setMoney(overRow.getCell(2));
        setRight(overRow.getCell(4)); setMoney(overRow.getCell(4));
        extraIdx++;
      }

      // 管理費（通訳料 + 延長料 に対して10%）
      const mgmtBase = interpFeeTotal + overtimeFee;
      const mgmtFee  = Math.round(mgmtBase * 0.1);
      const mgmtRow  = ws.getRow(r++);
      mgmtRow.getCell(1).value = `${extraIdx})　上記通訳料の10%（管理費）`;
      mgmtRow.getCell(4).value = mgmtFee;
      [1,2,3,4].forEach(c => { setFont(mgmtRow.getCell(c), 10); setBorder(mgmtRow.getCell(c)); });
      setRight(mgmtRow.getCell(4)); setMoney(mgmtRow.getCell(4));
      extraIdx++;

      // 移動拘束費・日当（travelPatternベース）
      const travelUnit = 28000, dailyUnit = 8000;
      let travelFee = 0, dailyFee = 0;

      if (outsideTokyo && travelPattern !== "none") {
        let travelCount = 0, dailyCount = 0;
        let travelQtyStr = "", dailyQtyStr = "";

        if (travelPattern === "sameDay") {
          travelCount = 2; dailyCount = 1;
          travelQtyStr = `${interpreters}名×2回`;
          dailyQtyStr  = `${interpreters}名×1泊`;
        } else if (travelPattern === "preDay") {
          travelCount = 2; dailyCount = 2;
          travelQtyStr = `${interpreters}名×2回`;
          dailyQtyStr  = `${interpreters}名×2泊`;
        } else if (travelPattern === "dayTrip") {
          travelCount = 1; dailyCount = 0;
          travelQtyStr = `${interpreters}名×1回`;
        }

        travelFee = travelUnit * numVal(interpreters) * travelCount;
        dailyFee  = dailyUnit  * numVal(interpreters) * dailyCount;

        if (travelFee > 0) {
          const tRow = ws.getRow(r++);
          tRow.getCell(1).value = `${extraIdx})　移動拘束費`;
          tRow.getCell(2).value = travelUnit;
          tRow.getCell(3).value = travelQtyStr;
          tRow.getCell(4).value = travelFee;
          [1,2,3,4].forEach(c => { setFont(tRow.getCell(c), 10); setBorder(tRow.getCell(c)); });
          setRight(tRow.getCell(2)); setMoney(tRow.getCell(2));
          setRight(tRow.getCell(4)); setMoney(tRow.getCell(4));
          extraIdx++;
        }

        if (dailyFee > 0) {
          const dRow = ws.getRow(r++);
          dRow.getCell(1).value = `${extraIdx})　日当`;
          dRow.getCell(2).value = dailyUnit;
          dRow.getCell(3).value = dailyQtyStr;
          dRow.getCell(4).value = dailyFee;
          [1,2,3,4].forEach(c => { setFont(dRow.getCell(c), 10); setBorder(dRow.getCell(c)); });
          setRight(dRow.getCell(2)); setMoney(dRow.getCell(2));
          setRight(dRow.getCell(4)); setMoney(dRow.getCell(4));
          extraIdx++;
        }

        // 交通費（実費）
        const transportLabel = transportRoute
          ? `交通費（${transportRoute}）` : "交通費";
        const transRow = ws.getRow(r++);
        transRow.getCell(1).value = `${extraIdx})　${transportLabel}`;
        ws.mergeCells(`B${transRow.number}:C${transRow.number}`);
        transRow.getCell(2).value = "実費で請求させていただきます";
        setCenter(transRow.getCell(2));
        transRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        transRow.getCell(4).value = "";
        [1,2,4].forEach(c => { setFont(transRow.getCell(c), 10); setBorder(transRow.getCell(c)); });
        extraIdx++;

        // 宿泊費（実費、宿泊ありの場合のみ）
        if (requiresStay) {
          const stayRow = ws.getRow(r++);
          stayRow.getCell(1).value = `${extraIdx})　宿泊費`;
          ws.mergeCells(`B${stayRow.number}:C${stayRow.number}`);
          stayRow.getCell(2).value = "実費で請求させていただきます";
          setCenter(stayRow.getCell(2));
          stayRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
          stayRow.getCell(4).value = "";
          [1,2,4].forEach(c => { setFont(stayRow.getCell(c), 10); setBorder(stayRow.getCell(c)); });
        }
      }

      r += 2; // 空行
      const beforeTax = mgmtBase + mgmtFee + travelFee + dailyFee;
      const tax   = isTaxExempt ? 0 : Math.round(beforeTax * 0.1);
      const grand = beforeTax + tax;
      r = addTotals(ws, r, beforeTax,
        isTaxExempt ? "免税" : tax,
        grand,
        isTaxExempt ? "消費税（免税）" : "消費税（10%）"
      );

      r++;
      const notes = [
        `納入日　　：${eventDate || "「項目」欄を参照"}`,
        `納入場所　：${location  || "「項目」欄を参照"}`,
        "お支払　　：請求日より30日以内銀行振込",
        "・通訳料半日とは、午前または午後4時間以内の拘束（実働3時間以内）を意味します",
        "・通訳料1日とは、4時間以上8時間以内の拘束（休憩含む）を意味します",
        "・通訳料のオーバータイムは、7,000円／0.5hとなります",
        "・通訳料のキャンセルは、当日・前日100％、2～3日前50％、4～7日前30％",
      ];
      notes.forEach(note => {
        ws.mergeCells(`A${r}:D${r}`);
        setFont(ws.getCell(`A${r}`), 9);
        ws.getCell(`A${r}`).value = note;
        r++;
      });
    }

    // ── 機材シート ──────────────────────────────────────────────
    if (type === "equipment" || type === "both") {
      const ws = workbook.addWorksheet("機材");
      ws.columns = [
        { width: 42 }, { width: 14 }, { width: 12 }, { width: 18 },
      ];

      buildHeader(ws, "機材費用など");

      const subjEquip = projectName
        ? `同時通訳機器レンタル（${projectName}）業務`
        : "同時通訳機器レンタル業務";
      ws.getCell("A8").value = "件名：" + subjEquip;
      setFont(ws.getCell("A8"), 10);

      let r = addItemsHeader(ws, 10);

      const items = Array.isArray(equipmentItems) ? equipmentItems : [];
      const equipTotal = items.reduce((s, it) => {
        return s + Math.max(1, numVal(it.quantity)) * Math.max(1, numVal(numDays)) * numVal(it.unitPrice);
      }, 0);

      // サマリー行
      const r1 = ws.getRow(r++);
      r1.getCell(1).value = "1)　同時通訳機器レンタル費用など";
      r1.getCell(2).value = "明細参照"; setCenter(r1.getCell(2));
      r1.getCell(3).value = "一式";
      r1.getCell(4).value = equipTotal; setRight(r1.getCell(4)); setMoney(r1.getCell(4));
      [1,2,3,4].forEach(c => { setFont(r1.getCell(c), 10); setBorder(r1.getCell(c)); });

      // 空行2行
      for (let i = 0; i < 2; i++) {
        const row = ws.getRow(r++);
        [1,2,3,4].forEach(c => { setFont(row.getCell(c), 10); setBorder(row.getCell(c)); });
      }

      // 値引き行（0より大きい場合のみ表示）
      const discountVal = Math.max(0, numVal(discount));
      if (discountVal > 0) {
        const discRow = ws.getRow(r++);
        discRow.getCell(1).value = "お値引き";
        discRow.getCell(4).value = -discountVal;
        setRight(discRow.getCell(4)); setMoney(discRow.getCell(4));
        [1,2,3,4].forEach(c => { setFont(discRow.getCell(c), 10); setBorder(discRow.getCell(c)); });
      }

      r += 2;
      const discountedTotal = Math.max(0, equipTotal - discountVal);
      const tax   = isTaxExempt ? 0 : Math.round(discountedTotal * 0.1);
      const grand = discountedTotal + tax;
      r = addTotals(ws, r, discountedTotal,
        isTaxExempt ? "免税" : tax,
        grand,
        isTaxExempt ? "消費税（免税）" : "消費税（10%）"
      );

      r++;
      const notes = [
        `納入日　　：${eventDate || "「同時通訳機器レンタル費用など明細」参照"}`,
        `納入場所　：${location  || "「同時通訳機器レンタル費用など明細」参照"}`,
        "お支払　　：請求日より30日以内銀行振込",
      ];
      notes.forEach(note => {
        ws.mergeCells(`A${r}:D${r}`);
        setFont(ws.getCell(`A${r}`), 9);
        ws.getCell(`A${r}`).value = note;
        r++;
      });
    }

    // ── 機器明細シート ──────────────────────────────────────────
    if (type === "equipment" || type === "both") {
      const nDays = Math.max(1, numVal(numDays));

      function buildDetailSheet(itemsList, sheetSuffix) {
        const sheetName = sheetSuffix ? `機器明細(${sheetSuffix})` : "機器明細";
        const titleText = "同時通訳装置レンタル費用明細" + (sheetSuffix ? `（${sheetSuffix}）` : "");
        const ws = workbook.addWorksheet(sheetName);
        ws.columns = [
          { width: 32 }, { width: 8 }, { width: 8 }, { width: 15 }, { width: 18 },
        ];

        ws.mergeCells("A1:E1");
        ws.getCell("A1").value = titleText;
        setFont(ws.getCell("A1"), 14, true);
        ws.getCell("A1").alignment = { horizontal: "center" };
        setBorder(ws.getCell("A1"));

        let r = 3;
        const infoRows = [
          ["会　議　名", projectName || ""],
          ["年　月　日", eventDate   || ""],
          ["場　　　所", location    || ""],
          ["設　　　営", "前日"],
          ["撤　　　去", "終了後"],
          ["録　　　音", "無"],
        ];
        infoRows.forEach(([label, val]) => {
          const row = ws.getRow(r);
          row.getCell(1).value = label;
          row.getCell(2).value = "：";
          ws.mergeCells(`C${r}:E${r}`);
          row.getCell(3).value = val;
          row.getCell(1).font = { name: FONT_NAME, size: 10, bold: true };
          [1,2,3].forEach(c => { setBorder(row.getCell(c)); });
          setFont(row.getCell(2), 10); setFont(row.getCell(3), 10);
          r++;
        });

        r++;

        const hRow = ws.getRow(r++);
        ["項　目", "台数", "日数", "単　価", "金　額"].forEach((h, i) => {
          const cell = hRow.getCell(i + 1);
          cell.value = h; setCenter(cell);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
          setFont(cell, 10, true); setBorder(cell);
        });

        let equipTotal = 0;
        (Array.isArray(itemsList) ? itemsList : []).forEach(it => {
          const row = ws.getRow(r++);
          row.getCell(1).value = it.name || "";
          if (it.venueEquipment) {
            ws.mergeCells(`B${row.number}:D${row.number}`);
            row.getCell(2).value = "会場常設を使用";
            setCenter(row.getCell(2));
            row.getCell(5).value = 0;
            setRight(row.getCell(5)); setMoney(row.getCell(5));
          } else {
            const qty    = Math.max(1, numVal(it.quantity));
            const amount = qty * nDays * numVal(it.unitPrice);
            equipTotal  += amount;
            row.getCell(2).value = qty;   setCenter(row.getCell(2));
            row.getCell(3).value = nDays; setCenter(row.getCell(3));
            row.getCell(4).value = numVal(it.unitPrice); setRight(row.getCell(4)); setMoney(row.getCell(4));
            row.getCell(5).value = amount;               setRight(row.getCell(5)); setMoney(row.getCell(5));
          }
          [1,2,3,4,5].forEach(c => { setFont(row.getCell(c), 10); setBorder(row.getCell(c)); });
        });

        for (let i = 0; i < 2; i++) {
          const emptyRow = ws.getRow(r++);
          [1,2,3,4,5].forEach(c => { setFont(emptyRow.getCell(c), 10); setBorder(emptyRow.getCell(c)); });
        }

        const totRow = ws.getRow(r++);
        totRow.getCell(1).value = "";
        totRow.getCell(2).value = "";
        ws.mergeCells(`C${totRow.number}:D${totRow.number}`);
        totRow.getCell(3).value = "合　計　金　額";
        totRow.getCell(3).alignment = { horizontal: "right" };
        totRow.getCell(5).value = equipTotal;
        setRight(totRow.getCell(5)); setMoney(totRow.getCell(5));
        [1,2,3,5].forEach(c => { setFont(totRow.getCell(c), 11, true); setBorder(totRow.getCell(c)); });

        r++;
        ["※合計金額には、消費税は含まれていません。",
         "※レシーバー（FM無線受信機）紛失の際には補償費を申し受けます（38,000円/1台）",
        ].forEach(note => {
          ws.mergeCells(`A${r}:E${r}`);
          ws.getCell(`A${r}`).value = note;
          setFont(ws.getCell(`A${r}`), 9);
          r++;
        });
      }

      if (isSplitMode && Array.isArray(studioItems) && Array.isArray(localItems)) {
        buildDetailSheet(studioItems, "スタジオ");
        buildDetailSheet(localItems,  "現地配信");
      } else {
        buildDetailSheet(Array.isArray(equipmentItems) ? equipmentItems : [], "");
      }
    }

    const filename = `見積書_${customerName || "未設定"}_${eventDate || ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("POST /quotes/export/excel error:", err);
    return res.status(500).json({ message: "Excel生成に失敗しました" });
  }
});

// ── GET /api/quotes/price-master ───────────────────────────
router.get("/price-master", auth, (req, res) => {
  const fs   = require("fs");
  const path = require("path");
  const filePath = path.join(__dirname, "../data/price-master.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.json(priceMaster);
  }
});

// ── POST /api/quotes/price-master ──────────────────────────
const adminAuth = require("../middleware/adminAuth");
router.post("/price-master", auth, adminAuth, async (req, res) => {
  try {
    const fs   = require("fs");
    const path = require("path");
    const newMaster = req.body;
    if (!Array.isArray(newMaster.interpretation) || !Array.isArray(newMaster.equipment)) {
      return res.status(400).json({ message: "interpretation と equipment 配列が必要です" });
    }
    const filePath = path.join(__dirname, "../data/price-master.json");
    await fs.promises.writeFile(filePath, JSON.stringify(newMaster, null, 2), "utf-8");
    delete require.cache[require.resolve("../data/price-master.json")];
    return res.json({ message: "保存しました" });
  } catch (err) {
    console.error("POST /quotes/price-master error:", err);
    return res.status(500).json({ message: "保存に失敗しました" });
  }
});

module.exports = router;
