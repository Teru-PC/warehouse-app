const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const QRCode = require("qrcode");

const router = express.Router();

// GET /api/equipment - 機材一覧
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, total_quantity, image_url, qr_png_base64, created_at
      FROM equipment
      ORDER BY id ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error("GET /equipment error:", err);
    return res.status(500).json({ error: "機材一覧の取得に失敗しました" });
  }
});

// GET /api/equipment/:id - 機材詳細
router.get("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT id, name, total_quantity, image_url, qr_png_base64, created_at FROM equipment WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "機材が見つかりません" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /equipment/:id error:", err);
    return res.status(500).json({ error: "機材の取得に失敗しました" });
  }
});

// POST /api/equipment - 機材登録
router.post("/", auth, async (req, res) => {
  try {
    const { name, total_quantity, image_url } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "機材名は必須です" });
    }
    if (!Number.isInteger(Number(total_quantity)) || Number(total_quantity) < 0) {
      return res.status(400).json({ error: "在庫数は0以上の整数を入力してください" });
    }

    // まず機材を登録
    const result = await pool.query(
      "INSERT INTO equipment (name, total_quantity, image_url) VALUES ($1, $2, $3) RETURNING id, name, total_quantity, image_url, created_at",
      [name.trim(), Number(total_quantity), image_url || null]
    );
    const eq = result.rows[0];

    // QRコードを生成してDBに保存
    const url = await QRCode.toDataURL(String(eq.id), { width: 200, margin: 2 });
    const base64 = url.replace(/^data:image\/png;base64,/, "");
    await pool.query("UPDATE equipment SET qr_png_base64 = $1 WHERE id = $2", [base64, eq.id]);
    eq.qr_png_base64 = base64;

    return res.status(201).json(eq);
  } catch (err) {
    console.error("POST /equipment error:", err);
    return res.status(500).json({ error: "機材の登録に失敗しました" });
  }
});

// PUT /api/equipment/:id - 機材編集
router.put("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, total_quantity, image_url } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "機材名は必須です" });
    }
    if (!Number.isInteger(Number(total_quantity)) || Number(total_quantity) < 0) {
      return res.status(400).json({ error: "在庫数は0以上の整数を入力してください" });
    }

    const result = await pool.query(
      "UPDATE equipment SET name = $1, total_quantity = $2, image_url = $3 WHERE id = $4 RETURNING id, name, total_quantity, image_url, qr_png_base64, created_at",
      [name.trim(), Number(total_quantity), image_url || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "機材が見つかりません" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /equipment/:id error:", err);
    return res.status(500).json({ error: "機材の更新に失敗しました" });
  }
});

// DELETE /api/equipment/:id - 機材削除
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM equipment WHERE id = $1", [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /equipment/:id error:", err);
    return res.status(500).json({ error: "機材の削除に失敗しました" });
  }
});

module.exports = router;