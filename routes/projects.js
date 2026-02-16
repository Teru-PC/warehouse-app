const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 案件作成
 * POST /projects
 */
router.post("/projects", auth, async (req, res) => {
  try {
    const {
      client_name,
      venue,
      person_in_charge,
      shipping_type,
      shipping_date,
      usage_start,
      usage_end
    } = req.body || {};

    if (!client_name || !usage_start) {
      return res.status(400).json({ message: "client_name and usage_start required" });
    }

    // arrival_date 自動計算
    let arrival_date = new Date(usage_start);

    if (shipping_type === "near") arrival_date.setDate(arrival_date.getDate() + 1);
    if (shipping_type === "far") arrival_date.setDate(arrival_date.getDate() + 2);
    if (shipping_type === "carry") {
      // 同日（そのまま）
    }

    const result = await pool.query(
      `INSERT INTO projects
      (client_name, venue, person_in_charge,
       status, shipping_type, shipping_date,
       usage_start, usage_end, arrival_date)
      VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        client_name,
        venue || null,
        person_in_charge || null,
        shipping_type || null,
        shipping_date || null,
        usage_start,
        usage_end || null,
        arrival_date
      ]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Project creation failed" });
  }
});

/**
 * confirmed に変更（在庫ロック）
 * PATCH /projects/:id/confirm
 */
router.patch("/projects/:id/confirm", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const projectId = req.params.id;

    // 対象案件をロック（状態確認）
    const proj = await client.query(
      "SELECT id, status FROM projects WHERE id=$1 FOR UPDATE",
      [projectId]
    );
    if (!proj.rows.length) throw new Error("Project not found");
    if (proj.rows[0].status === "cancelled") throw new Error("Project is cancelled");

    // 案件アイテム取得
    const items = await client.query(
      "SELECT equipment_id, quantity FROM project_items WHERE project_id=$1",
      [projectId]
    );

    // items が空でも confirmed にできるが、通常は何かしら入る想定
    for (const item of items.rows) {
      // 対象機材の在庫行をロック
      const equipment = await client.query(
        "SELECT total_quantity FROM equipment WHERE id=$1 FOR UPDATE",
        [item.equipment_id]
      );
      if (!equipment.rows.length) throw new Error(`Equipment not found: ${item.equipment_id}`);

      const total = equipment.rows[0].total_quantity;

      // confirmed案件で使用中の数量合計（自分以外）
      const used = await client.query(
        `
        SELECT COALESCE(SUM(pi.quantity),0)::int as used
        FROM project_items pi
        JOIN projects p ON pi.project_id = p.id
        WHERE pi.equipment_id=$1
          AND p.status='confirmed'
          AND p.id <> $2
        `,
        [item.equipment_id, projectId]
      );

      const available = total - used.rows[0].used;

      if (available < item.quantity) {
        throw new Error(`Stock shortage for equipment ${item.equipment_id}`);
      }
    }

    // OKなら confirmed
    await client.query("UPDATE projects SET status='confirmed' WHERE id=$1", [projectId]);

    await client.query("COMMIT");
    return res.json({ message: "Project confirmed" });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
