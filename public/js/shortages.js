function qs(name) {
  return new URL(location.href).searchParams.get(name);
}

function getToken() {
  const keys = ["token", "jwt", "authToken", "access_token"];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v) return v.replace(/^Bearer\s+/i, "");
  }
  return null;
}

async function api(path) {
  const token = getToken();

  const res = await fetch(path, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  const text = await res.text();

  let data;
  try { data = JSON.parse(text); }
  catch { data = text; }

  if (!res.ok) {
    throw new Error(data.message || text);
  }

  return data;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

async function loadProject(projectId) {
  const p = await api(`/api/projects/${projectId}`);

  document.getElementById("projectInfo").innerHTML = `
    <div><b>案件:</b> ${esc(p.title)}</div>
    <div><b>使用:</b> ${esc(p.usage_start_at)} ～ ${esc(p.usage_end_at)}</div>
    <div>
      <a href="/project-items.html?project_id=${projectId}">
        機材割当へ
      </a>
    </div>
  `;
}

function renderResult(rows) {

  if (!rows.length) {
    document.getElementById("resultWrap").innerHTML =
      "機材割当がありません。";
    return;
  }

  const hasShortage = rows.some(r => r.shortage);
  const summary = hasShortage
    ? `<div style="background:#fee2e2;border:2px solid #dc2626;border-radius:8px;padding:10px 14px;margin-bottom:12px;color:#991b1b;font-weight:700;">⚠️ 在庫が不足している機材があります</div>`
    : `<div style="background:#dcfce7;border:2px solid #16a34a;border-radius:8px;padding:10px 14px;margin-bottom:12px;color:#166534;font-weight:700;">✅ 在庫は足りています</div>`;

  const html = summary + `
  <table>
    <thead>
      <tr>
        <th>機材</th>
        <th>必要</th>
        <th>総在庫</th>
        <th>使用中</th>
        <th>利用可能</th>
        <th>状態</th>
        <th>不足数</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr class="${r.shortage ? "ng" : "ok"}">
          <td>${esc(r.equipment_name)}</td>
          <td>${r.required}</td>
          <td>${r.total}</td>
          <td>${r.used}</td>
          <td>${r.available}</td>
          <td>${r.shortage ? "⚠️ 不足" : "✅ OK"}</td>
          <td>${r.shortage ? r.shortage_amount : "-"}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  `;

  document.getElementById("resultWrap").innerHTML = html;
}

async function main() {

  const projectId = qs("project_id");

  if (!projectId) {
    document.body.innerHTML =
      "project_id がありません";
    return;
  }

  try {

    await loadProject(projectId);

    const rows = await api(
      `/api/shortages?project_id=${projectId}`
    );

    renderResult(rows);

  } catch (err) {

    document.getElementById("resultWrap").innerHTML =
      `<div style="color:red">${err.message}</div>`;

  }
}

main();