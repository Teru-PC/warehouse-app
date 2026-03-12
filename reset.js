const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false }
});
pool.query('UPDATE projects SET hidden_shipping = false, hidden_interpreter = false')
  .then(r => { console.log('リセット完了:', r.rowCount, '件'); process.exit(0); })
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
``