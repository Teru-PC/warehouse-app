const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 案件一覧
 */
router.get("/projects", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        p.usage_start AS usage_start_at,
        p.usage_end   AS usage_end_at
      FROM projects p
      ORDER BY p.usage_start ASC NULLS LAST, p.id ASC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

/**
 * 案件詳細
 */
router.get("/projects/:id", auth, async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT
        p.*,
        p.usage_start AS usage_start_at,
        p.usage_end   AS usage_end_at
      FROM projects p
      WHERE id=$1
    `, [req.params.id]);

    if (!result.rows.length)
      return res.status(404).json({ message: "not found" });

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * 案件作成
 */
router.post("/projects", auth, async (req, res) => {
  try {

    const {
      title,
      client_name,
      venue,
      person_in_charge,
      status,
      shipping_type,
      shipping_date,
      usage_start_at,
      usage_end_at,
      usage_start,
      usage_end
    } = req.body || {};

    const s = new Date(usage_start_at ?? usage_start);
    const e = new Date(usage_end_at ?? usage_end);

    const result = await pool.query(`
      INSERT INTO projects
      (
        title,
        client_name,
        venue,
        person_in_charge,
        status,
        shipping_type,
        shipping_date,
        usage_start,
        usage_end
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *,
        usage_start AS usage_start_at,
        usage_end   AS usage_end_at
    `,
    [
      title,
      client_name,
      venue,
      person_in_charge,
      status ?? "draft",
      shipping_type,
      shipping_date,
      s.toISOString(),
      e.toISOString()
    ]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * confirmed 変更（不足チェック付き）
 */
router.patch("/projects/:id/confirm", auth, async (req, res) => {

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const projectId = req.params.id;

    // 対象案件の期間
    const proj = await client.query(`
      SELECT usage_start, usage_end
      FROM projects
      WHERE id=$1
      FOR UPDATE
    `, [projectId]);

    if (!proj.rows.length)
      throw new Error("project not found");

    const currentStart = proj.rows[0].usage_start;
    const currentEnd   = proj.rows[0].usage_end;

    // 不足チェックSQL
    const shortage = await client.query(`
      WITH req AS (
        SELECT equipment_id, SUM(quantity) AS required
        FROM project_items
        WHERE project_id=$1
        GROUP BY equipment_id
      ),
      used AS (
        SELECT
          pi.equipment_id,
          SUM(pi.quantity) AS used
        FROM project_items pi
        JOIN projects p ON p.id=pi.project_id
        WHERE p.status='confirmed'
          AND p.id<>$1
          AND p.usage_start < $2
          AND p.usage_end   > $3
        GROUP BY pi.equipment_id
      )
      SELECT
        e.name,
        r.required,
        e.total_quantity,
        COALESCE(u.used,0) AS used,
        e.total_quantity - COALESCE(u.used,0) AS available
      FROM req r
      JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN used u ON u.equipment_id=r.equipment_id
      WHERE r.required > (e.total_quantity - COALESCE(u.used,0))
    `,
    [projectId, currentEnd, currentStart]);

    if (shortage.rows.length > 0) {

      await client.query("ROLLBACK");

      return res.status(400).json({
        message: "Stock shortage",
        shortages: shortage.rows
      });
    }

    // confirmedへ変更
    await client.query(`
      UPDATE projects
      SET status='confirmed'
      WHERE id=$1
    `, [projectId]);

    await client.query("COMMIT");

    res.json({ success: true });

  } catch (err) {

    await client.query("ROLLBACK");

    res.status(400).json({
      message: err.message
    });

  } finally {

    client.release();

  }
});

/**
 * 案件更新
 */
router.put("/projects/:id", auth, async (req, res) => {
  try {

    const {
      title,
      client_name,
      venue,
      person_in_charge,
      status,
      shipping_type,
      shipping_date,
      usage_start_at,
      usage_end_at
    } = req.body;

    const result = await pool.query(`
      UPDATE projects
      SET
        title=$1,
        client_name=$2,
        venue=$3,
        person_in_charge=$4,
        status=$5,
        shipping_type=$6,
        shipping_date=$7,
        usage_start=$8,
        usage_end=$9
      WHERE id=$10
      RETURNING *,
        usage_start AS usage_start_at,
        usage_end   AS usage_end_at
    `,
    [
      title,
      client_name,
      venue,
      person_in_charge,
      status,
      shipping_type,
      shipping_date,
      usage_start_at,
      usage_end_at,
      req.params.id
    ]);

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 削除
 */
router.delete("/projects/:id", auth, async (req, res) => {

  await pool.query(
    "DELETE FROM projects WHERE id=$1",
    [req.params.id]
  );

  res.json({ success: true });

});

module.exports = router;