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

// Google認証URLを取得
router.get("/auth/google", auth, (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });
  res.json({ url });
});

// Google認証コールバック
router.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await pool.query(`
      INSERT INTO google_tokens (id, access_token, refresh_token, expiry_date)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO UPDATE
        SET access_token=$1, refresh_token=$2, expiry_date=$3
    `, [tokens.access_token, tokens.refresh_token, tokens.expiry_date]);

    res.send(`
      <html><body>
        <script>
          window.opener && window.opener.postMessage('google-auth-success', '*');
          window.close();
        </script>
        <p>認証成功！このウィンドウを閉じてください。</p>
      </body></html>
    `);
  } catch (err) {
    console.error("Google callback error:", err);
    res.status(500).send("認証に失敗しました: " + err.message);
  }
});

// 認証状態を確認
router.get("/google/status", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, expiry_date FROM google_tokens WHERE id=1");
    if (!result.rows.length) return res.json({ connected: false });
    res.json({ connected: true, expiry_date: result.rows[0].expiry_date });
  } catch (err) {
    res.json({ connected: false });
  }
});

// HTMLタグ除去
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * メモから通訳名を抽出
 * 「通訳：山田」「通訳:山田さん」「通訳：山田NG」「通訳：（未定）」などに対応
 * → 名前のみ返す（さん/NG/（未定）/(未定)を除去）
 * → 通訳の記載がなければ null を返す
 */
function extractInterpreterName(memo) {
  if (!memo) return null;
  // 全角・半角コロン両対応
  const match = memo.match(/通訳[：:]\s*([^\n]+)/);
  if (!match) return null;

  let name = match[1].trim();
  // 不要な語句を除去
  name = name
    .replace(/さん/g, '')
    .replace(/NG/gi, '')
    .replace(/（未定）/g, '')
    .replace(/\(未定\)/g, '')
    .replace(/（.*?）/g, '')   // 全角括弧内を除去
    .replace(/\(.*?\)/g, '')   // 半角括弧内を除去
    .trim();

  return name || null;
}

// Googleカレンダーカラーマップ
const COLOR_MAP = {
  '1':  '#7986cb',
  '2':  '#33b679',
  '3':  '#8d24aa',
  '4':  '#e67b73',
  '5':  '#f6bf26',
  '6':  '#f4511e',
  '7':  '#039be5',
  '8':  '#616161',
  '9':  '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
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
      await pool.query(`
        UPDATE google_tokens SET access_token=$1, expiry_date=$2 WHERE id=1
      `, [newTokens.access_token, newTokens.expiry_date]);
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // カレンダーリストの色を取得
    const calListRes = await calendar.calendarList.list();
    const calColorMap = {};
    for (const cal of calListRes.data.items || []) {
      calColorMap[cal.id] = cal.backgroundColor || null;
    }

    // 今日から3ヶ月先のイベントを取得
    const now = new Date();
    const threeMonthsLater = new Date();
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: threeMonthsLater.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100
    });

    const events = response.data.items || [];
    const activeEventIds = new Set(events.map(e => e.id));

    let importedCount = 0;
    let updatedCount  = 0;
    let deletedCount  = 0;

    // ─── Googleで削除されたイベントをDBから削除 ───────────
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

    // ─── 新規追加・既存更新 ───────────────────────────────
    for (const event of events) {
      const startStr = event.start?.dateTime || event.start?.date;
      const endStr   = event.end?.dateTime   || event.end?.date;
      if (!startStr || !endStr) continue;

      const usageStart = new Date(startStr);
      const usageEnd   = new Date(endStr);
      const isAllDay   = !event.start?.dateTime;
      const memo       = stripHtml(event.description || "");
      const calColor   = calColorMap['bilin.original@gmail.com'] || '#3d57c4';
      const googleColor = event.colorId
        ? (COLOR_MAP[event.colorId] || calColor)
        : calColor;

      // 通訳メモの解析 → hidden_interpreterの決定
      const interpreterName = extractInterpreterName(memo);
      const hiddenInterpreter = interpreterName ? false : true;

      // 既存チェック
      const existing = await pool.query(
        "SELECT id FROM projects WHERE google_event_id=$1",
        [event.id]
      );

      if (existing.rows.length > 0) {
        // ─── 既存案件を更新 ───
        await pool.query(`
          UPDATE projects SET
            title             = $1,
            venue             = $2,
            usage_start       = $3,
            usage_end         = $4,
            memo              = $5,
            color             = $6,
            is_all_day        = $7,
            hidden_interpreter = $8
          WHERE google_event_id = $9
        `, [
          event.summary || "(無題)",
          event.location || "",
          usageStart.toISOString(),
          usageEnd.toISOString(),
          memo,
          googleColor,
          isAllDay,
          hiddenInterpreter,
          event.id
        ]);
        updatedCount++;
        console.log(`Updated: ${event.summary} | interpreter: ${interpreterName || 'none'}`);

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
        await pool.query(`
          INSERT INTO projects
            (title, venue, status, usage_start, usage_end, google_event_id,
             memo, color, is_all_day, hidden_interpreter)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
        importedCount++;
        console.log(`Imported: ${event.summary} | interpreter: ${interpreterName || 'none'}`);
      }
    }

    console.log(`Google sync: ${importedCount} imported, ${updatedCount} updated, ${deletedCount} deleted`);
    return { imported: importedCount, updated: updatedCount, deleted: deletedCount };

  } catch (err) {
    console.error("Google Calendar import error:", err);
    throw err;
  }
}

// 手動インポートAPI
router.post("/google/import", auth, async (req, res) => {
  try {
    const result = await importFromGoogle();
    res.json({
      success: true,
      imported: result.imported,
      updated:  result.updated,
      deleted:  result.deleted
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 自動同期（1時間ごと）
cron.schedule("0 * * * *", async () => {
  console.log("Running scheduled Google Calendar sync...");
  try {
    await importFromGoogle();
  } catch (err) {
    console.error("Scheduled sync error:", err);
  }
});

module.exports = router;