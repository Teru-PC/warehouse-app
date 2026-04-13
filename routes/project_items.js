const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 案件に紐づく機材割当一覧
 * GET /project-items?project_id=123 -> /api/project-items?project_id=123
 */
router.get("/project-items", auth, async (req, res) => {
  try {
    const projectId = Number(req.query.project_id);
    if (!projectId) return res.status(400).json({ message: "project_id is required" });

    const result = await pool.query(
      `
      SELECT
        pi.id,
        pi.project_id,
        pi.equipment_id,
        pi.quantity,
        e.name AS equipment_name,
        e.total_quantity AS equipment_total_quantity
      FROM project_items pi
      JOIN equipment e ON e.id = pi.equipment_id
      WHERE pi.project_id = $1
      ORDER BY pi.id ASC
      `,
      [projectId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("GET /project-items error:", err);
    return res.status(500).json({ message: "Failed to fetch project items" });
  }
});

/**
 * 機材割当の追加（同一 project_id + equipment_id は数量更新）
 * POST /project-items -> /api/project-items
 * body: { project_id, equipment_id, quantity }
 */
router.post("/project-items", auth, async (req, res) => {
  try {
    const projectId = Number(req.body?.project_id);
    const equipmentId = Number(req.body?.equipment_id);
    const quantity = Number(req.body?.quantity ?? 1);

    if (!projectId) return res.status(400).json({ message: "project_id is required" });
    if (!equipmentId) return res.status(400).json({ message: "equipment_id is required" });
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ message: "quantity must be integer >= 0" });
    }

    const result = await pool.query(
      `
      INSERT INTO project_items (project_id, equipment_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (project_id, equipment_id)
      DO UPDATE SET quantity = EXCLUDED.quantity
      RETURNING id, project_id, equipment_id, quantity
      `,
      [projectId, equipmentId, quantity]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /project-items error:", err);
    return res.status(500).json({ message: "Failed to create project item" });
  }
});

/**
 * 割当の数量変更
 * PUT /project-items/:id -> /api/project-items/:id
 * body: { quantity }
 */
router.put("/project-items/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const quantity = Number(req.body?.quantity);

    if (!id) return res.status(400).json({ message: "id is required" });
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ message: "quantity must be integer >= 0" });
    }

    const result = await pool.query(
      `
      UPDATE project_items
      SET quantity = $1
      WHERE id = $2
      RETURNING id, project_id, equipment_id, quantity
      `,
      [quantity, id]
    );

    if (!result.rows.length) return res.status(404).json({ message: "Project item not found" });

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /project-items/:id error:", err);
    return res.status(500).json({ message: "Failed to update project item" });
  }
});

/**
 * 割当削除
 * DELETE /project-items/:id -> /api/project-items/:id
 */
router.delete("/project-items/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id is required" });

    const result = await pool.query(
      `DELETE FROM project_items WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) return res.status(404).json({ message: "Project item not found" });

    return res.json({ success: true, id });
  } catch (err) {
    console.error("DELETE /project-items/:id error:", err);
    return res.status(500).json({ message: "Failed to delete project item" });
  }
});
/**
 * PATCH /api/project-items/:id/check
 * body: { checked: true/false }
 * 機材1件のチェック状態を更新
 */
router.patch("/project-items/:id/check", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { checked } = req.body;

    if (typeof checked !== "boolean") {
      return res.status(400).json({ error: "checked must be boolean" });
    }

    const result = await pool.query(
      `UPDATE project_items SET checked = $1 WHERE id = $2 RETURNING *`,
      [checked, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json({ success: true, item: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update check" });
  }
});

/**
 * GET /api/project-items/detail?project_id=1
 * 機材名も含めて返却（チェックリスト表示用）
 */
router.get("/project-items/detail", auth, async (req, res) => {
  try {
    const { project_id } = req.query;

    if (!project_id) {
      return res.status(400).json({ error: "project_id required" });
    }

    const result = await pool.query(
      `SELECT pi.id, pi.equipment_id, pi.quantity, pi.checked,
              e.name AS equipment_name, e.image_url
       FROM project_items pi
       JOIN equipment e ON e.id = pi.equipment_id
       WHERE pi.project_id = $1
       ORDER BY e.name ASC`,
      [project_id]
    );

    res.json({ items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch detail" });
  }
});

module.exports = router;