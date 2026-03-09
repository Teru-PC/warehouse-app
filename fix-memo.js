require('dotenv').config();
const pool = require('./db');

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

pool.query("SELECT id, memo FROM projects WHERE memo IS NOT NULL AND memo != ''")
  .then(function(r) {
    console.log(r.rows.length + '件のメモを更新します');
    var updates = r.rows.map(function(row) {
      return pool.query('UPDATE projects SET memo=$1 WHERE id=$2', [stripHtml(row.memo), row.id]);
    });
    return Promise.all(updates);
  })
  .then(function() {
    console.log('OK! メモのHTMLタグを除去しました');
    pool.end();
  })
  .catch(function(e) {
    console.error(e.message);
    pool.end();
  });