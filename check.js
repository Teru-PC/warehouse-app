require('dotenv').config();
const pool = require('./db');
const fs = require('fs');

async function restore() {
  const sql = fs.readFileSync('backup.sql', 'utf8');
  try {
    await pool.query(sql);
    console.log('インポート成功！');
  } catch(e) {
    console.error('エラー:', e.message);
  }
  process.exit();
}

restore();