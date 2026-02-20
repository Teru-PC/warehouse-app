const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const db = require("../db");

// 暫定パスワード（後で正式なパスワード設定機能で上書きする）
// NOT NULL 制約を満たすためのダミー。
// 実運用では必ず変更すること。
const TEMP_PASSWORD = "__TEMP_PASSWORD_CHANGE_LATER__";

router.post("/login", async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email || String(email).trim() === "") {
      return res.status(400).json({ error: "email required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // 既存ユーザー確認
    let result = await db.query(
      "SELECT id, email, role FROM users WHERE email = $1",
      [normalizedEmail]
    );

    let user = result.rows[0];

    // 無ければ作成（password_hash はダミーで埋める）
    if (!user) {
      const tempHash = await bcrypt.hash(TEMP_PASSWORD, 10);

      const insert = await db.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role`,
        ["Temp User", normalizedEmail, tempHash, "admin"]
      );

      user = insert.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "login failed" });
  }
});

module.exports = router;