const express = require("express");
const router = express.Router();
const db = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "warehouse_secret_key";

// ログイン履歴を記録するヘルパー
async function recordLoginLog(userId, success, ip) {
  try {
    await db.query(
      "INSERT INTO login_logs (user_id, success, ip_address) VALUES ($1, $2, $3)",
      [userId || null, success, ip || null]
    );
  } catch (e) {
    console.error("login_log error:", e);
  }
}

// ─── ログイン ────────────────────────────────────────────────
router.post("/api/auth/login", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || null;
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "メールとパスワードを入力してください" });
    }
    const result = await db.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      await recordLoginLog(null, false, ip);
      return res.status(401).json({ error: "メールまたはパスワードが違います" });
    }
    const user = result.rows[0];

    // パスワード未設定（初回ユーザー）
    if (!user.password_hash) {
      return res.status(403).json({ error: "first_login", message: "初回パスワードの設定が必要です" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordLoginLog(user.id, false, ip);
      return res.status(401).json({ error: "メールまたはパスワードが違います" });
    }
    await recordLoginLog(user.id, true, ip);
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ログインに失敗しました" });
  }
});

// ─── 初回パスワード設定 ──────────────────────────────────────
router.post("/api/auth/setup-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "メールとパスワードを入力してください" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "パスワードは6文字以上で設定してください" });
    }

    const result = await db.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "登録されていないメールアドレスです" });
    }
    const user = result.rows[0];

    // すでにパスワードが設定済みの場合は拒否
    if (user.password_hash) {
      return res.status(400).json({ error: "このアカウントはすでにパスワードが設定されています" });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, user.id]);

    res.json({ success: true, message: "パスワードを設定しました。ログインしてください。" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "パスワード設定に失敗しました" });
  }
});

// ─── 認証確認 ────────────────────────────────────────────────
router.get("/api/auth/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "認証が必要です" });
    }
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ user: decoded });
  } catch (err) {
    res.status(401).json({ error: "トークンが無効です" });
  }
});

router.post("/api/auth/logout", (req, res) => {
  res.json({ success: true });
});

module.exports = router;