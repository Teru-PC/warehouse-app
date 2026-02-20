const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 不足判定（他の confirmed 案件の使用中数量も加味）
 * GET /shortages?project_id=123 -> /api/shortages?project_id=123
 *
 * 判定条件（時間が重なる confirmed 案件のみ「使用中」として計上）:
 * overlap: p.usage_start < current_end AND p.usage_end > current_start
 *
 * 返す: 対象案件に割り当てがある機材だけ
 */
router.get("/shortages", auth, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    if (!projectId) return res.status(400).json({ message: "project_id is required" });

    // まず対象案件の期間を取得
    const proj = await pool.query(
      `SELECT id, usage_start, usage_end FROM projects WHERE id = $1`,
      [projectId]
    );
    if (!proj.rows.length) return res.status(404).json({ message: "Project not found" });

    const currentStart = proj.rows[0].usage_start;
    const currentEnd = proj.rows[0].usage_end;

    if (!currentStart || !currentEnd) {
      return res.status(400).json({ message: "Project usage_start/usage_end is required" });
    }

    // 不足判定（SQLでまとめて計算）
    const result = await pool.query(
      `
      WITH current_proj AS (
        SELECT $1::int AS project_id,
               $2::timestamptz AS current_start,
               $3::timestamptz AS current_end
      ),
      req AS (
        SELECT
          pi.equipment_id,
          SUM(pi.quantity)::int AS required
        FROM project_items pi
        WHERE pi.project_id = $1
        GROUP BY pi.equipment_id
      ),
      used AS (
        SELECT
          pi.equipment_id,
          COALESCE(SUM(pi.quantity), 0)::int AS used
        FROM project_items pi
        JOIN projects p ON p.id = pi.project_id
        JOIN current_proj c ON true
        WHERE p.status = 'confirmed'
          AND p.id <> $1
          AND p.usage_start IS NOT NULL
          AND p.usage_end IS NOT NULL
          AND p.usage_start < c.current_end
          AND p.usage_end   > c.current_start
        GROUP BY pi.equipment_id
      )
      SELECT
        r.equipment_id,
        e.name AS equipment_name,
        r.required,
        e.total_quantity::int AS total,
        COALESCE(u.used, 0)::int AS used,
        (e.total_quantity::int - COALESCE(u.used, 0)::int) AS available,
        GREATEST(r.required - (e.total_quantity::int - COALESCE(u.used, 0)::int), 0) AS shortage_amount,
        (r.required > (e.total_quantity::int - COALESCE(u.used, 0)::int)) AS shortage
      FROM req r
      JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN used u ON u.equipment_id = r.equipment_id
      ORDER BY r.equipment_id ASC
      `,
      [projectId, currentStart, currentEnd]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("GET /shortages error:", err);
    return res.status(500).json({ message: "Failed to calculate shortages" });
  }
});

module.exports = router;