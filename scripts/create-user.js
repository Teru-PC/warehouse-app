require('dotenv').config();
const db = require('../db');
const bcrypt = require('bcryptjs');

const NAME = '管理者';
const EMAIL = 'bilin.original@gmail.com';
const PASSWORD = 'Bilingual2525';
const ROLE = 'admin';

(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET password_hash = $3, role = $4',
    [NAME, EMAIL, hash, ROLE]
  );
  console.log('ユーザー作成完了:', EMAIL);
  process.exit();
})().catch(e => {
  console.error(e);
  process.exit(1);
});