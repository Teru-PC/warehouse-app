const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 案件一覧（メインカレンダー用：両方hiddenのものを除外）
 */
router.get("/projects", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        p.usage_start AS usage_start_at,
        p.usage_end   AS usage_end_at
      FROM projects p
      WHERE NOT (COALESCE(p.hidden_shipping, false) = true AND COALESCE(p.hidden_interpreter, false) = true)
        AND p.deleted_at IS NULL
      ORDER BY p.usage_start ASC NULLS LAST, p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

/**
 * 案件一覧（発送確認用：hidden_shippingを除外）
 */
router.get("/projects/shipping", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        p.usage_start AS usage_start_at,
        p.usage_end   AS usage_end_at
      FROM projects p
      WHERE COALESCE(p.hidden_shipping, false) = false
        AND p.deleted_at IS NULL
        AND COALESCE(p.has_star, false) = true
      ORDER BY p.usage_start ASC NULLS LAST, p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

/**
 * 案件一覧（通訳カレンダー用：hidden_interpreterを除外）
 */
router.get("/projects/interpreter", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        p.usage_start AS usage_start_at,
        p.usage_end   AS usage_end_at,
        COALESCE(
          json_agg(
            json_build_object('name', pi.name, 'status', pi.status, 'cxl_label', pi.cxl_label)
          ) FILTER (WHERE pi.id IS NOT NULL),
          '[]'
        ) AS interpreters
      FROM projects p
      LEFT JOIN project_interpreters pi ON pi.project_id = p.id
      WHERE (COALESCE(p.hidden_interpreter, false) = false
         OR EXISTS (SELECT 1 FROM project_interpreters pi2 WHERE pi2.project_id = p.id))
        AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.usage_start ASC NULLS LAST, p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

router.get("/projects/softdeleted", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, venue, usage_start, usage_end, color, deleted_at
       FROM projects
       WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
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
      title, client_name, venue, person_in_charge, status,
      shipping_type, shipping_date, return_due_date,
      usage_start_at, usage_end_at, usage_start, usage_end
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: "タイトルは必須です" });
    }
    const s = new Date(usage_start_at ?? usage_start);
    const e = new Date(usage_end_at ?? usage_end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) {
      return res.status(400).json({ message: "日時が不正です" });
    }
    if (s >= e) {
      return res.status(400).json({ message: "開始日時は終了日時より前にしてください" });
    }

    const result = await pool.query(`
      INSERT INTO projects
        (title, client_name, venue, person_in_charge, status,
         shipping_type, shipping_date, return_due_date, usage_start, usage_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *, usage_start AS usage_start_at, usage_end AS usage_end_at
    `, [title, client_name, venue, person_in_charge, status ?? "draft",
        shipping_type, shipping_date, return_due_date,
        s.toISOString(), e.toISOString()]);

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
    const proj = await client.query(`
      SELECT usage_start, usage_end FROM projects WHERE id=$1 FOR UPDATE
    `, [projectId]);
    if (!proj.rows.length) throw new Error("project not found");
    const currentStart = proj.rows[0].usage_start;
    const currentEnd   = proj.rows[0].usage_end;

    const shortage = await client.query(`
      WITH req AS (
        SELECT equipment_id, SUM(quantity) AS required
        FROM project_items
        WHERE project_id=$1 AND quantity > 0
        GROUP BY equipment_id
      ),
      used AS (
        SELECT pi.equipment_id, SUM(pi.quantity) AS used
        FROM project_items pi
        JOIN projects p ON p.id=pi.project_id
        WHERE p.status='confirmed' AND p.id<>$1
          AND p.usage_start < $2 AND p.usage_end > $3
          AND pi.quantity > 0
        GROUP BY pi.equipment_id
      )
      SELECT e.name, r.required, e.total_quantity,
        COALESCE(u.used,0) AS used,
        e.total_quantity - COALESCE(u.used,0) AS available
      FROM req r
      JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN used u ON u.equipment_id=r.equipment_id
      WHERE r.required > (e.total_quantity - COALESCE(u.used,0))
    `, [projectId, currentEnd, currentStart]);

    if (shortage.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Stock shortage", shortages: shortage.rows });
    }

    await client.query(`UPDATE projects SET status='confirmed' WHERE id=$1`, [projectId]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: err.message });
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
      title, client_name, venue, person_in_charge, status,
      shipping_type, shipping_date, return_due_date,
      usage_start_at, usage_end_at
    } = req.body;

    const result = await pool.query(`
      UPDATE projects
      SET title=$1, client_name=$2, venue=$3, person_in_charge=$4, status=$5,
          shipping_type=$6, shipping_date=$7, return_due_date=$8,
          usage_start=$9, usage_end=$10
      WHERE id=$11
      RETURNING *, usage_start AS usage_start_at, usage_end AS usage_end_at
    `, [title, client_name, venue, person_in_charge, status,
        shipping_type, shipping_date, return_due_date,
        usage_start_at, usage_end_at, req.params.id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 発送確認から非表示（hidden_shipping = true）
 */
router.delete("/projects/:id/hide-shipping", auth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE projects SET hidden_shipping = true WHERE id=$1",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 通訳カレンダーから非表示（hidden_interpreter = true）
 */
router.delete("/projects/:id/hide-interpreter", auth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE projects SET hidden_interpreter = true WHERE id=$1",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 完全削除（案件編集画面から）
 */
router.delete("/projects/:id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM projects WHERE id=$1 RETURNING id",
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ message: "not found" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * ゴミ箱に移動（論理削除）
 */
router.delete("/projects/:id/trash", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const proj = await client.query("SELECT * FROM projects WHERE id=$1", [req.params.id]);
    if (!proj.rows.length) return res.status(404).json({ message: "not found" });
    const p = proj.rows[0];
    await client.query(`
      INSERT INTO deleted_projects
        (original_id, title, client_name, venue, person_in_charge, status,
         shipping_type, shipping_date, return_due_date, usage_start, usage_end, google_event_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [p.id, p.title, p.client_name, p.venue, p.person_in_charge, p.status,
        p.shipping_type, p.shipping_date, p.return_due_date,
        p.usage_start, p.usage_end, p.google_event_id || null]);
    await client.query("DELETE FROM projects WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

/**
 * ゴミ箱一覧
 */
router.get("/trash", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM deleted_projects ORDER BY deleted_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * ゴミ箱から完全削除
 */
router.delete("/trash/:id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM deleted_projects WHERE id=$1 RETURNING id",
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ message: "not found" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * ゴミ箱から復元
 */
router.post("/trash/:id/restore", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM deleted_projects WHERE id=$1", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: "not found" });
    const p = result.rows[0];
    await client.query(`
      INSERT INTO projects
        (title, client_name, venue, person_in_charge, status,
         shipping_type, shipping_date, return_due_date, usage_start, usage_end)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [p.title, p.client_name, p.venue, p.person_in_charge, p.status,
        p.shipping_type, p.shipping_date, p.return_due_date,
        p.usage_start, p.usage_end]);
    await client.query("DELETE FROM deleted_projects WHERE id=$1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

/**
 * 通訳カレンダーから案件を削除（ソフトデリート）
 */
router.delete("/projects/:id/soft", auth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE projects SET deleted_at=NOW() WHERE id=$1",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * ソフトデリートされた案件を復元
 */
router.post("/projects/:id/restore", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE projects SET deleted_at=NULL WHERE id=$1 RETURNING id",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;