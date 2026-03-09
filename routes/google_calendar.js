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

/**
 * Google認証URLを取得
 */
router.get("/auth/google", auth, (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });
  res.json({ url });
});

/**
 * Google認証コールバック
 */
router.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    // トークンをDBに保存
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

/**
 * 認証状態を確認
 */
router.get("/google/status", auth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, expiry_date FROM google_tokens WHERE id=1");
    if (!result.rows.length) return res.json({ connected: false });
    res.json({ connected: true, expiry_date: result.rows[0].expiry_date });
  } catch (err) {
    res.json({ connected: false });
  }
});

/**
 * Googleカレンダーから案件をインポート
 */
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

async function importFromGoogle() {
  try {
    const result = await pool.query("SELECT * FROM google_tokens WHERE id=1");
    if (!result.rows.length) {
      console.log("Google token not found, skipping import");
      return { imported: 0 };
    }

    const tokens = result.rows[0];
    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    });

    // トークン更新時に保存
    oauth2Client.on("tokens", async (newTokens) => {
      await pool.query(`
        UPDATE google_tokens
        SET access_token=$1, expiry_date=$2
        WHERE id=1
      `, [newTokens.access_token, newTokens.expiry_date]);
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // カレンダーリストの色を取得
    const calListRes = await calendar.calendarList.list();
    const calColorMap = {};
    for (const cal of calListRes.data.items || []) {
      calColorMap[cal.id] = cal.backgroundColor || null;
      console.log(`Calendar: ${cal.summary} / id: ${cal.id} / color: ${cal.backgroundColor}`);
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
    let importedCount = 0;
    let updatedCount = 0; 

    for (const event of events) {
      // 既にインポート済みか確認
      const existing = await pool.query(
        "SELECT id FROM projects WHERE google_event_id=$1",
        [event.id]
      );
      if (existing.rows.length) continue;

      // ゴミ箱に移動済みの場合もスキップ
      const deleted = await pool.query(
        "SELECT id FROM deleted_projects WHERE google_event_id=$1",
        [event.id]
      );
      if (deleted.rows.length) continue;

      // 日時の取得
      const startStr = event.start?.dateTime || event.start?.date;
      const endStr   = event.end?.dateTime   || event.end?.date;
      if (!startStr || !endStr) continue;

      const usageStart = new Date(startStr);
      const usageEnd   = new Date(endStr);

      // 終日イベントかどうかを記録
      const isAllDay = !event.start?.dateTime;

      // ✅ Googleカレンダー公式カラーマップ（colorId → hex）
      // 正しい対応: 1=Lavender, 2=Sage, 3=Grape, 4=Flamingo, 5=Banana,
      //             6=Tangerine, 7=Peacock, 8=Graphite, 9=Blueberry, 10=Basil, 11=Tomato
      const colorMap = {
        '1':  '#7986cb', // ラベンダー（青紫）
        '2':  '#33b679', // セージ（緑）
        '3':  '#8d24aa', // グレープ（紫）
        '4':  '#e67b73', // フラミンゴ（薄いピンク）
        '5':  '#f6bf26', // バナナ（黄色）
        '6':  '#f4511e', // タンジェリン（オレンジ）
        '7':  '#039be5', // ピーコック（水色）
        '8':  '#616161', // グラファイト（グレー）
        '9':  '#3f51b5', // ブルーベリー（濃い青）
        '10': '#0b8043', // バジル（濃い緑）
        '11': '#d50000', // トマト（濃い赤）
      };

      // イベント個別の色 → なければそのイベントが属するカレンダーの色
      const calColor = calColorMap['bilin.original@gmail.com'] || '#3d57c4';
      const googleColor = event.colorId
        ? (colorMap[event.colorId] || calColor)
        : calColor;
      console.log(`Event: ${event.summary} | colorId: ${event.colorId} | color: ${googleColor}`);

      // 案件として登録
      await pool.query(`
        INSERT INTO projects
          (title, venue, status, usage_start, usage_end, google_event_id, memo, color, is_all_day)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        event.summary || "(無題)",
        event.location || "",
        "confirmed",
        usageStart.toISOString(),
        usageEnd.toISOString(),
        event.id,
        stripHtml(event.description || ""),
        googleColor,
        isAllDay
      ]);

      importedCount++;
    }

    console.log(`Google Calendar import: ${importedCount} events imported`);
    return { imported: importedCount };

  } catch (err) {
    console.error("Google Calendar import error:", err);
    throw err;
  }
}

/**
 * 手動インポートAPI
 */
router.post("/google/import", auth, async (req, res) => {
  try {
    const result = await importFromGoogle();
    res.json({ success: true, imported: result.imported });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 自動同期（1時間ごと）
 */
cron.schedule("0 * * * *", async () => {
  console.log("Running scheduled Google Calendar import...");
  try {
    await importFromGoogle();
  } catch (err) {
    console.error("Scheduled import error:", err);
  }
});

module.exports = router;