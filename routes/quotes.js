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
- 同時通訳料（英語・中国語・フランス語など言語別）
- 延長料・超過料金（通訳）
- 移動拘束費（東京以外の出張時のみ）
- 日当（東京以外の出張時のみ）
- 交通費（東京以外の出張時のみ）
- 宿泊費（東京以外の出張時のみ）
- 通訳音声二次使用料（依頼がある場合のみ）
※管理費（通訳料の10%）は自動計算するため含めない

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

【出力フォーマット（JSONのみ返すこと）】
{
  "type": "interpretation" | "equipment" | "both" | "english",
  "customerName": "顧客名（不明な場合は null）",
  "projectName": "案件名・イベント名（不明な場合は null）",
  "eventDate": "日程（例: 2025年3月15日、不明な場合は null）",
  "location": "開催場所（不明な場合は null）",
  "outsideTokyo": 東京以外の場合は true、東京または不明の場合は false,
  "interpreters": 通訳者数（数値、不明な場合は 1）,
  "languages": ["言語ペア（例: 日本語-英語, 日本語-中国語, 日本語-フランス語）（不明な場合は []）"],
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
      discount     = 0,
      numDays      = 1,
      interpreters = 1,
      outsideTokyo = false,
      isTaxExempt  = false,
      languages    = [],
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

      // 管理費
      const interpFeeTotal = items.reduce((s, it) => s + numVal(it.subtotal), 0);
      const mgmtFee = Math.round(interpFeeTotal * 0.1);
      const mgmtRow = ws.getRow(r++);
      mgmtRow.getCell(1).value = `${items.length + 1})　上記通訳料の10%（管理費）`;
      mgmtRow.getCell(3).value = "一式";
      mgmtRow.getCell(4).value = mgmtFee;
      [1,2,3,4].forEach(c => { setFont(mgmtRow.getCell(c), 10); setBorder(mgmtRow.getCell(c)); });
      setRight(mgmtRow.getCell(4)); setMoney(mgmtRow.getCell(4));

      // 東京以外
      let travelTotal = 0, dailyTotal = 0;
      if (outsideTokyo) {
        const travelUnit = 28000, dailyUnit = 8000;
        travelTotal = travelUnit * numVal(interpreters) * numVal(numDays);
        dailyTotal  = dailyUnit  * numVal(interpreters) * numVal(numDays);
        const qtyStr = `${interpreters}名×${numDays}日`;

        const tRow = ws.getRow(r++);
        tRow.getCell(1).value = `${items.length + 2})　移動拘束費`;
        tRow.getCell(2).value = travelUnit; tRow.getCell(3).value = qtyStr;
        tRow.getCell(4).value = travelTotal;
        [1,2,3,4].forEach(c => { setFont(tRow.getCell(c), 10); setBorder(tRow.getCell(c)); });
        setRight(tRow.getCell(2)); setMoney(tRow.getCell(2));
        setRight(tRow.getCell(4)); setMoney(tRow.getCell(4));

        const dRow = ws.getRow(r++);
        dRow.getCell(1).value = `${items.length + 3})　日当`;
        dRow.getCell(2).value = dailyUnit; dRow.getCell(3).value = qtyStr;
        dRow.getCell(4).value = dailyTotal;
        [1,2,3,4].forEach(c => { setFont(dRow.getCell(c), 10); setBorder(dRow.getCell(c)); });
        setRight(dRow.getCell(2)); setMoney(dRow.getCell(2));
        setRight(dRow.getCell(4)); setMoney(dRow.getCell(4));
      }

      r += 2; // 空行
      const beforeTax = interpFeeTotal + mgmtFee + (outsideTokyo ? travelTotal + dailyTotal : 0);
      const tax   = isTaxExempt ? 0 : Math.round(beforeTax * 0.1);
      const grand = beforeTax + tax;
      r = addTotals(ws, r, beforeTax,
        isTaxExempt ? "免税" : tax,
        grand,
        isTaxExempt ? "消費税（免税）" : "消費税（10%）"
      );

      r++;
      const notes = [
        "納入日　　：「項目」欄を参照",
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

      // 空行3行
      for (let i = 0; i < 3; i++) {
        const row = ws.getRow(r++);
        [1,2,3,4].forEach(c => { setFont(row.getCell(c), 10); setBorder(row.getCell(c)); });
      }

      // 値引き行
      const discountVal = Math.max(0, numVal(discount));
      const discRow = ws.getRow(r++);
      discRow.getCell(1).value = "お値引き";
      discRow.getCell(4).value = discountVal > 0 ? -discountVal : 0;
      setRight(discRow.getCell(4)); setMoney(discRow.getCell(4));
      [1,2,3,4].forEach(c => { setFont(discRow.getCell(c), 10); setBorder(discRow.getCell(c)); });

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
      const ws = workbook.addWorksheet("機器明細");
      ws.columns = [
        { width: 32 }, { width: 8 }, { width: 8 }, { width: 15 }, { width: 16 }, { width: 14 },
      ];

      // タイトル
      ws.mergeCells("A1:F1");
      ws.getCell("A1").value = "同時通訳装置レンタル費用明細";
      setFont(ws.getCell("A1"), 14, true);
      ws.getCell("A1").alignment = { horizontal: "center" };
      setBorder(ws.getCell("A1"));

      // 情報テーブル
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
        ws.mergeCells(`C${r}:F${r}`);
        row.getCell(3).value = val;
        row.getCell(1).font = { name: FONT_NAME, size: 10, bold: true };
        [1,2,3].forEach(c => { setBorder(row.getCell(c)); });
        setFont(row.getCell(2), 10); setFont(row.getCell(3), 10);
        r++;
      });

      r++; // 空行

      // 明細ヘッダー
      const hRow = ws.getRow(r++);
      ["項　目", "台数", "日数", "単　価", "金　額", "備　考"].forEach((h, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = h; setCenter(cell);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        setFont(cell, 10, true); setBorder(cell);
      });

      // 明細行
      const items = Array.isArray(equipmentItems) ? equipmentItems : [];
      const nDays = Math.max(1, numVal(numDays));
      let equipTotal = 0;
      items.forEach(it => {
        const qty    = Math.max(1, numVal(it.quantity));
        const amount = qty * nDays * numVal(it.unitPrice);
        equipTotal  += amount;
        const row = ws.getRow(r++);
        row.getCell(1).value = it.name || "";
        row.getCell(2).value = qty;   setCenter(row.getCell(2));
        row.getCell(3).value = nDays; setCenter(row.getCell(3));
        row.getCell(4).value = numVal(it.unitPrice); setRight(row.getCell(4)); setMoney(row.getCell(4));
        row.getCell(5).value = amount;               setRight(row.getCell(5)); setMoney(row.getCell(5));
        row.getCell(6).value = "";
        [1,2,3,4,5,6].forEach(c => { setFont(row.getCell(c), 10); setBorder(row.getCell(c)); });
      });

      // 合計行
      const totRow = ws.getRow(r++);
      ws.mergeCells(`A${totRow.number}:C${totRow.number}`);
      totRow.getCell(1).value = "合　計　金　額";
      totRow.getCell(1).alignment = { horizontal: "center" };
      ws.mergeCells(`D${totRow.number}:E${totRow.number}`);
      totRow.getCell(4).value = equipTotal;
      setRight(totRow.getCell(4)); setMoney(totRow.getCell(4));
      [1,4,6].forEach(c => { setFont(totRow.getCell(c), 11, true); setBorder(totRow.getCell(c)); });

      r++;
      ["※合計金額には、消費税は含まれていません。",
       "※レシーバー（FM無線受信機）紛失の際には補償費を申し受けます（38,000円/1台）",
      ].forEach(note => {
        ws.mergeCells(`A${r}:F${r}`);
        ws.getCell(`A${r}`).value = note;
        setFont(ws.getCell(`A${r}`), 9);
        r++;
      });
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

module.exports = router;
