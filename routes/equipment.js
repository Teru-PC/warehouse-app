const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * 機材一覧
 * GET /equipment -> /api/equipment
 */
router.get("/equipment", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        total_quantity,
        image_url,
        created_at
      FROM equipment
      ORDER BY id ASC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error("GET /equipment error:", err);
    return res.status(500).json({ message: "Failed to fetch equipment" });
  }
});

module.exports = router;