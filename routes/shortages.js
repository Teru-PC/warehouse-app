const express = require("express");
const pool    = require("../db");
const auth    = require("../middleware/auth");
const router  = express.Router();

/**
 * 期間の決定ルール：
 * - shipping_date と return_due_date が両方ある → その期間でカウント
 * - どちらかNULL → usage_start ～ usage_end でカウント
 * - ステータスは無視（全案件対象）
 */

// ─── 単一案件の不足判定 GET /api/shortages?project_id=123 ───
router.get("/shortages", auth, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);

    // 範囲指定モード（カレンダー用）
    if (!projectId && req.query.from) {
      return handleRangeShortage(req, res);
    }

    if (!projectId) return res.status(400).json({ message: "project_id is required" });

    const proj = await pool.query(
      `SELECT id, shipping_date, return_due_date, usage_start, usage_end
       FROM projects WHERE id = $1`,
      [projectId]
    );
    if (!proj.rows.length) return res.status(404).json({ message: "Project not found" });

    const p = proj.rows[0];
    const useShipping = p.shipping_date && p.return_due_date;
    const rangeStart  = useShipping ? p.shipping_date : p.usage_start;
    const rangeEnd    = useShipping ? p.return_due_date : p.usage_end;

    if (!rangeStart || !rangeEnd) {
      return res.status(400).json({ message: "期間が設定されていません" });
    }

    const result = await pool.query(`
      WITH req AS (
        SELECT equipment_id, SUM(quantity)::int AS required
        FROM project_items WHERE project_id = $1
        GROUP BY equipment_id
      ),
      used AS (
        SELECT pi.equipment_id, COALESCE(SUM(pi.quantity), 0)::int AS used
        FROM project_items pi
        JOIN projects p ON p.id = pi.project_id
        WHERE p.id <> $1
          AND (
            CASE
              WHEN p.shipping_date IS NOT NULL AND p.return_due_date IS NOT NULL
                THEN p.shipping_date::timestamptz < $3::timestamptz
                 AND p.return_due_date::timestamptz > $2::timestamptz
              ELSE
                p.usage_start IS NOT NULL AND p.usage_end IS NOT NULL
                AND p.usage_start < $3::timestamptz
                AND p.usage_end   > $2::timestamptz
            END
          )
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
    `, [projectId, rangeStart, rangeEnd]);

    return res.json(result.rows);
  } catch (err) {
    console.error("GET /shortages error:", err);
    return res.status(500).json({ message: "Failed to calculate shortages" });
  }
});

// ─── 範囲指定モード（カレンダー表示期間内の全案件を一括チェック）───
async function handleRangeShortage(req, res) {
  try {
    const from = req.query.from; // YYYY-MM-DD
    const to   = req.query.to;   // YYYY-MM-DD

    // fromの開始(00:00 JST = 前日15:00 UTC)、toの終了(翌日00:00 JST = 当日15:00 UTC)
    const fromTs = `${from}T00:00:00+09:00`;
    const toTs   = `${to}T23:59:59+09:00`;

    // 表示期間内にある全案件を取得
    const projResult = await pool.query(`
      SELECT id, shipping_date, return_due_date, usage_start, usage_end
      FROM projects
      WHERE NOT (COALESCE(hidden_shipping, false) = true AND COALESCE(hidden_interpreter, false) = true)
        AND (
          (shipping_date IS NOT NULL AND return_due_date IS NOT NULL
            AND shipping_date::timestamptz <= $2::timestamptz
            AND return_due_date::timestamptz >= $1::timestamptz)
          OR
          (usage_start IS NOT NULL AND usage_end IS NOT NULL
            AND usage_start <= $2::timestamptz
            AND usage_end   >= $1::timestamptz)
        )
    `, [fromTs, toTs]);

    const projects = projResult.rows;
    if (!projects.length) return res.json({ projects: [] });

    // 各案件の不足判定を並列実行
    const results = await Promise.all(projects.map(async (p) => {
      const useShipping = p.shipping_date && p.return_due_date;
      const rangeStart  = useShipping ? `${p.shipping_date}T00:00:00+09:00` : p.usage_start;
      const rangeEnd    = useShipping ? `${p.return_due_date}T23:59:59+09:00` : p.usage_end;

      const r = await pool.query(`
        WITH req AS (
          SELECT equipment_id, SUM(quantity)::int AS required
          FROM project_items WHERE project_id = $1
          GROUP BY equipment_id
        ),
        used AS (
          SELECT pi.equipment_id, COALESCE(SUM(pi.quantity), 0)::int AS used
          FROM project_items pi
          JOIN projects p ON p.id = pi.project_id
          WHERE p.id <> $1
            AND (
              CASE
                WHEN p.shipping_date IS NOT NULL AND p.return_due_date IS NOT NULL
                  THEN p.shipping_date::timestamptz < $3::timestamptz
                   AND p.return_due_date::timestamptz > $2::timestamptz
                ELSE
                  p.usage_start IS NOT NULL AND p.usage_end IS NOT NULL
                  AND p.usage_start < $3::timestamptz
                  AND p.usage_end   > $2::timestamptz
              END
            )
          GROUP BY pi.equipment_id
        )
        SELECT bool_or(r.required > (e.total_quantity::int - COALESCE(u.used,0)::int)) AS shortage
        FROM req r
        JOIN equipment e ON e.id = r.equipment_id
        LEFT JOIN used u ON u.equipment_id = r.equipment_id
      `, [p.id, rangeStart, rangeEnd]);

      return {
        project_id: p.id,
        shortage: r.rows[0]?.shortage ?? false
      };
    }));

    return res.json({ projects: results });
  } catch (err) {
    console.error("handleRangeShortage error:", err);
    return res.status(500).json({ message: "Failed to calculate shortages" });
  }
}

module.exports = router;