const express = require("express");
const router  = express.Router();
const db      = require("../db");
const bcrypt  = require("bcryptjs");
const auth    = require("../middleware/auth");

// adminロールチェックミドルウェア
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "管理者権限が必要です" });
  }
  next();
}

// ─── ユーザー一覧 ───────────────────────────────────────────
router.get("/api/admin/users", auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ユーザー一覧の取得に失敗しました" });
  }
});

// ─── ユーザー追加 ───────────────────────────────────────────
router.post("/api/admin/users", auth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "名前・メール・パスワードは必須です" });
    }
    // 重複チェック
    const exists = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: "このメールアドレスは既に使用されています" });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at",
      [name, email, hash, role || "user"]
    );
    // 変更履歴を記録
    await logChange(req.user.id, "user_add", `ユーザー追加: ${name} (${email})`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ユーザー追加に失敗しました" });
  }
});

// ─── ユーザー削除 ───────────────────────────────────────────
router.delete("/api/admin/users/:id", auth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: "自分自身は削除できません" });
    }
    const target = await db.query("SELECT name, email FROM users WHERE id = $1", [id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: "ユーザーが見つかりません" });
    }
    await db.query("DELETE FROM users WHERE id = $1", [id]);
    await logChange(req.user.id, "user_delete", `ユーザー削除: ${target.rows[0].name} (${target.rows[0].email})`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ユーザー削除に失敗しました" });
  }
});

// ─── ログイン履歴 ───────────────────────────────────────────
router.get("/api/admin/login-logs", auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ll.id, ll.user_id, u.name, u.email, ll.logged_in_at, ll.success, ll.ip_address
      FROM login_logs ll
      LEFT JOIN users u ON ll.user_id = u.id
      ORDER BY ll.logged_in_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ログイン履歴の取得に失敗しました" });
  }
});

// ─── 変更履歴 ───────────────────────────────────────────────
router.get("/api/admin/change-logs", auth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT cl.id, cl.user_id, u.name, u.email, cl.action, cl.detail, cl.changed_at
      FROM change_logs cl
      LEFT JOIN users u ON cl.user_id = u.id
      ORDER BY cl.changed_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "変更履歴の取得に失敗しました" });
  }
});

// ─── 内部ヘルパー：変更履歴を記録 ──────────────────────────
async function logChange(userId, action, detail) {
  try {
    await db.query(
      "INSERT INTO change_logs (user_id, action, detail) VALUES ($1, $2, $3)",
      [userId, action, detail]
    );
  } catch (e) {
    console.error("change_log error:", e);
  }
}

// ─── 外部からlogChangeを使えるようにエクスポート ────────────
router.logChange = logChange;

module.exports = router;