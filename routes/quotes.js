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

module.exports = router;
