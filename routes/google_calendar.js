const express = require("express");
const { google } = require("googleapis");
const pool = require("../db");
const auth = require("../middleware/auth");
const cron = require("node-cron");

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

router.get("/auth/google", auth, (req, res) => {
  const url = oauth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
  res.json({ url });
});

router.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await pool.query(`
      INSERT INTO google_tokens (id, access_token, refresh_token, expiry_date)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET access_token=$1, refresh_token=$2, expiry_date=$3
    `, [tokens.access_token, tokens.refresh_token, tokens.expiry_date]);
    res.send(`<html><body><script>window.opener&&window.opener.postMessage('google-auth-success','*');window.close();</script><p>認証成功！このウィンドウを閉じてください。</p></body></html>`);
  } catch (err) {
    console.error("Google callback error:", err);
    res.status(500).send("認証に失敗しました: " + err.message);
  }
});

router.get("/google/status", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, expiry_date FROM google_tokens WHERE id=1");
    if (!result.rows.length) return res.json({ connected: false });
    res.json({ connected: true, expiry_date: result.rows[0].expiry_date });
  } catch (err) {
    res.json({ connected: false });
  }
});

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * メモから通訳者リストを抽出
 * 戻り値: { active: ['山田', '鈴木'], cxl: ['田中'] }
 * - 通訳：○○ → active
 * - NG：○○ / キャンセル：○○ / CXL：○○ → cxl
 */
function extractInterpreters(memo) {
  if (!memo) return { active: [], cxl: [] };

  function cleanName(raw) {
    return raw
      .replace(/さん/g, '')
      .replace(/[→＞>].*/g, '')   // 矢印（全角・半角）以降を除去
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[　\s]/g, '')
      .trim();
  }

  // 「、」「,」「，」「　」「 」で分割して複数名を抽出
  function extractNames(line) {
    const parts = line.split(/[、,，　\s]+/);
    return parts.map(p => cleanName(p)).filter(n =>
      n.length > 0 &&
      !/^\d/.test(n) &&
      !/名$/.test(n)
    );
  }

  const active = [];
  const cxl = []; // { name, label }

  // コロン（全角・半角）＋セミコロン（全角・半角）両対応
  const activeRe = /通訳[：:；;]([^\n\r]+)/g;
  const ngRe     = /NG[：:；;]([^\n\r]+)/gi;
  const cxlRe    = /(?:キャンセル|CXL)[：:；;]([^\n\r]+)/gi;

  let m;
  while ((m = activeRe.exec(memo)) !== null) {
    extractNames(m[1]).forEach(n => active.push(n));
  }
  while ((m = ngRe.exec(memo)) !== null) {
    extractNames(m[1]).forEach(n => cxl.push({ name: n, label: 'NG' }));
  }
  while ((m = cxlRe.exec(memo)) !== null) {
    extractNames(m[1]).forEach(n => cxl.push({ name: n, label: 'CXL' }));
  }

  // 重複除去（nameで）CXL優先
  const cxlUniq = [...new Map(cxl.map(c => [c.name, c])).values()];
  const cxlNames = new Set(cxlUniq.map(c => c.name));

  // activeにCXLと同名がいれば除外（CXL優先）
  const activeUniq = [...new Set(active)].filter(n => !cxlNames.has(n));

  return { active: activeUniq, cxl: cxlUniq };
}

/**
 * project_interpretersを同期する
 * - activeにある名前 → upsert status='active'
 * - cxlにある名前 → upsert status='cxl'
 * - activeにもcxlにもないが既にDBにある名前 → status='cxl'（メモから削除された）
 */
async function syncInterpreters(projectId, active, cxl) {
  const existing = await pool.query(
    "SELECT name, status, cxl_label FROM project_interpreters WHERE project_id=$1",
    [projectId]
  );
  const existingMap = new Map(existing.rows.map(r => [r.name, r]));
  const cxlMap = new Map(cxl.map(c => [c.name, c]));
  const allNames = new Set([...active, ...cxl.map(c => c.name), ...existingMap.keys()]);

  for (const name of allNames) {
    let newStatus, newLabel;
    if (cxlMap.has(name)) {
      newStatus = 'cxl';
      newLabel  = cxlMap.get(name).label || 'CXL';
    } else if (active.includes(name)) {
      newStatus = 'active';
      newLabel  = null;
    } else {
      newStatus = 'cxl';
      newLabel  = existingMap.get(name)?.cxl_label || 'CXL';
    }

    await pool.query(`
      INSERT INTO project_interpreters (project_id, name, status, cxl_label)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id, name) DO UPDATE SET status = $3, cxl_label = $4
    `, [projectId, name, newStatus, newLabel]);
  }
}

const COLOR_MAP = {
  '1':'#7986cb','2':'#33b679','3':'#8d24aa','4':'#e67b73','5':'#f6bf26',
  '6':'#f4511e','7':'#039be5','8':'#616161','9':'#3f51b5','10':'#0b8043','11':'#d50000',
};

async function importFromGoogle() {
  try {
    const result = await pool.query("SELECT * FROM google_tokens WHERE id=1");
    if (!result.rows.length) {
      console.log("Google token not found, skipping import");
      return { imported: 0, updated: 0, deleted: 0 };
    }

    const tokens = result.rows[0];
    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    });
    oauth2Client.on("tokens", async (newTokens) => {
      await pool.query("UPDATE google_tokens SET access_token=$1, expiry_date=$2 WHERE id=1",
        [newTokens.access_token, newTokens.expiry_date]);
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const calListRes = await calendar.calendarList.list();
    const calColorMap = {};
    for (const cal of calListRes.data.items || []) {
      calColorMap[cal.id] = cal.backgroundColor || null;
    }

    const now = new Date();
    const threeMonthsLater = new Date();
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: threeMonthsLater.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500
    });

    const events = response.data.items || [];
    const activeEventIds = new Set(events.map(e => e.id));

    let importedCount = 0, updatedCount = 0, deletedCount = 0;

    // ─── Googleで削除されたイベントをDBから削除 ───
    const dbProjects = await pool.query(
      "SELECT id, google_event_id FROM projects WHERE google_event_id IS NOT NULL"
    );
    for (const dbRow of dbProjects.rows) {
      if (!activeEventIds.has(dbRow.google_event_id)) {
        await pool.query("DELETE FROM projects WHERE id=$1", [dbRow.id]);
        console.log(`Deleted project id=${dbRow.id} (Google event removed)`);
        deletedCount++;
      }
    }

    // ─── 新規追加・既存更新 ───
    for (const event of events) {
      const startStr = event.start?.dateTime || event.start?.date;
      const endStr   = event.end?.dateTime   || event.end?.date;
      if (!startStr || !endStr) continue;

      const usageStart  = new Date(startStr);
      const usageEnd    = new Date(endStr);
      const isAllDay    = !event.start?.dateTime;
      const memo        = stripHtml(event.description || "");
      const calColor    = calColorMap['bilin.original@gmail.com'] || '#3d57c4';
      const googleColor = event.colorId ? (COLOR_MAP[event.colorId] || calColor) : calColor;
      const { active, cxl } = extractInterpreters(memo);
      const hiddenInterpreter = (active.length === 0 && cxl.length === 0);

      // 既存チェック
      const existing = await pool.query(
        "SELECT id, usage_start FROM projects WHERE google_event_id=$1", [event.id]
      );

      if (existing.rows.length > 0) {
        // ─── 既存案件を更新 ───
        const projectId = existing.rows[0].id;
        const oldStart  = new Date(existing.rows[0].usage_start);
        const diffMs    = usageStart.getTime() - oldStart.getTime();
        const diffDays  = Math.round(diffMs / 86400000);

        // 発送日・返却日を日数分ずらす
        if (diffDays !== 0) {
          await pool.query(`
            UPDATE projects SET
              shipping_date    = CASE WHEN shipping_date IS NOT NULL
                                 THEN (shipping_date::date + $1::int) ELSE NULL END,
              return_due_date  = CASE WHEN return_due_date IS NOT NULL
                                 THEN (return_due_date::date + $1::int) ELSE NULL END
            WHERE id = $2
          `, [diffDays, projectId]);
        }

        await pool.query(`
          UPDATE projects SET
            title              = $1,
            venue              = $2,
            usage_start        = $3,
            usage_end          = $4,
            memo               = $5,
            color              = $6,
            is_all_day         = $7,
            hidden_interpreter = $8
          WHERE id = $9
        `, [
          event.summary || "(無題)",
          event.location || "",
          usageStart.toISOString(),
          usageEnd.toISOString(),
          memo,
          googleColor,
          isAllDay,
          hiddenInterpreter,
          projectId
        ]);

        // 通訳者テーブルを同期
        await syncInterpreters(projectId, active, cxl);
        updatedCount++;
        console.log(`Updated: ${event.summary} | active:[${active}] cxl:[${cxl}]`);

      } else {
        // ─── ゴミ箱チェック ───
        const deletedByEventId = await pool.query(
          "SELECT id FROM deleted_projects WHERE google_event_id=$1", [event.id]
        );
        if (deletedByEventId.rows.length) continue;

        const deletedByTitle = await pool.query(
          "SELECT id FROM deleted_projects WHERE title=$1 AND usage_start=$2",
          [event.summary || "(無題)", usageStart.toISOString()]
        );
        if (deletedByTitle.rows.length) continue;

        // ─── 新規追加 ───
        const inserted = await pool.query(`
          INSERT INTO projects
            (title, venue, status, usage_start, usage_end, google_event_id,
             memo, color, is_all_day, hidden_interpreter)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          RETURNING id
        `, [
          event.summary || "(無題)",
          event.location || "",
          "confirmed",
          usageStart.toISOString(),
          usageEnd.toISOString(),
          event.id,
          memo,
          googleColor,
          isAllDay,
          hiddenInterpreter
        ]);

        // 通訳者テーブルに登録
        await syncInterpreters(inserted.rows[0].id, active, cxl);
        importedCount++;
        console.log(`Imported: ${event.summary} | active:[${active}] cxl:[${cxl}]`);
      }
    }

    console.log(`Google sync: ${importedCount} imported, ${updatedCount} updated, ${deletedCount} deleted`);
    return { imported: importedCount, updated: updatedCount, deleted: deletedCount };

  } catch (err) {
    console.error("Google Calendar import error:", err);
    throw err;
  }
}

router.post("/google/import", auth, async (req, res) => {
  try {
    const result = await importFromGoogle();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

cron.schedule("0 * * * *", async () => {
  console.log("Running scheduled Google Calendar sync...");
  try { await importFromGoogle(); }
  catch (err) { console.error("Scheduled sync error:", err); }
});

module.exports = router;