const express = require("express");
const pool    = require("../db");
const auth    = require("../middleware/auth");
const router  = express.Router();

// ─── 単一案件の不足判定 GET /api/shortages?project_id=123 ───
router.get("/shortages", auth, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);

    if (!projectId && req.query.from) {
      return handleRangeShortage(req, res);
    }
    if (!projectId) return res.status(400).json({ message: "project_id is required" });

    const proj = await pool.query(
      `SELECT id, shipping_date, return_due_date, usage_start, usage_end
       FROM projects WHERE id = $1`, [projectId]
    );
    if (!proj.rows.length) return res.status(404).json({ message: "Project not found" });

    const p = proj.rows[0];
    // 日単位で判定
    const toJstDate = (d) => {
      const dt = d instanceof Date ? d : new Date(d);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(dt);
    };
    const startDate = p.shipping_date ? toJstDate(p.shipping_date) : (p.usage_start ? toJstDate(p.usage_start) : null);
    const endDate   = p.return_due_date ? toJstDate(p.return_due_date) : (p.usage_end ? toJstDate(p.usage_end) : null);
    const rangeStart = startDate ? `${startDate}T00:00:00+09:00` : null;
    const rangeEnd   = endDate   ? `${endDate}T23:59:59+09:00`   : null;

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
              WHEN 1=1
                THEN
                COALESCE(p.shipping_date::date, p.usage_start::date) <= $3::date
                AND
                COALESCE(p.return_due_date::date, p.usage_end::date) >= $2::date
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

// ─── 範囲指定モード（カレンダー用）───
async function handleRangeShortage(req, res) {
  try {
    const from = req.query.from; // YYYY-MM-DD
    const to   = req.query.to;   // YYYY-MM-DD

    // 表示期間内の全案件を取得
    const projResult = await pool.query(`
      SELECT id, shipping_date, return_due_date, usage_start, usage_end
      FROM projects
      WHERE NOT (COALESCE(hidden_shipping, false) = true AND COALESCE(hidden_interpreter, false) = true)
        AND (
          (shipping_date IS NOT NULL AND return_due_date IS NOT NULL
            AND shipping_date::date <= $2::date
            AND return_due_date::date >= $1::date)
          OR
          (usage_start IS NOT NULL AND usage_end IS NOT NULL
            AND usage_start::date <= $2::date
            AND usage_end::date   >= $1::date)
        )
    `, [from, to]);

    const projects = projResult.rows;
    if (!projects.length) return res.json({ projects: [] });

    // 各案件の不足判定を並列実行
    const results = await Promise.all(projects.map(async (p) => {
      // 日単位で判定：案件が存在する日付の開始〜終了（JST）
      const toJstDateStr = (d) => {
        const dt = d instanceof Date ? d : new Date(d);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(dt);
      };
      // 案件の日付範囲（発送日優先、なければusage）
      const startDate = p.shipping_date ? toJstDateStr(p.shipping_date) : toJstDateStr(p.usage_start);
      const endDate   = p.return_due_date ? toJstDateStr(p.return_due_date) : toJstDateStr(p.usage_end);
      // 日の開始（JST 00:00）〜翌日開始（JST 00:00）でtimestamptzに変換
      const rangeStart = `${startDate}T00:00:00+09:00`;
      const rangeEnd   = `${endDate}T23:59:59+09:00`;

      try {
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
                -- 日単位で重複チェック（発送日優先、なければusage）
                COALESCE(p.shipping_date::date, p.usage_start::date) <= $3::date
                AND
                COALESCE(p.return_due_date::date, p.usage_end::date) >= $2::date
              )
            GROUP BY pi.equipment_id
          )
          SELECT bool_or(r.required > (e.total_quantity::int - COALESCE(u.used,0)::int)) AS shortage
          FROM req r
          JOIN equipment e ON e.id = r.equipment_id
          LEFT JOIN used u ON u.equipment_id = r.equipment_id
        `, [p.id, rangeStart, rangeEnd]);

        const shortage = r.rows[0]?.shortage === true;
        if (p.id === 192 || p.id === 193) {
          console.log(`DEBUG2 project ${p.id}: rangeStart=${rangeStart} rangeEnd=${rangeEnd} result=${JSON.stringify(r.rows[0])}`);
        }
        return { project_id: p.id, shortage };
      } catch(e) {
        console.error(`shortage check error for project ${p.id}:`, e.message);
        return { project_id: p.id, shortage: false };
      }
    }));

    return res.json({ projects: results });
  } catch (err) {
    console.error("handleRangeShortage error:", err);
    return res.status(500).json({ message: "Failed to calculate shortages" });
  }
}

module.exports = router;