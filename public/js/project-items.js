function qs(name) {
  return new URL(location.href).searchParams.get(name);
}

function getToken() {
  return localStorage.getItem("token");
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers || {}
  );
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && data.message) ? data.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadProject(projectId) {
  // 既存 API: /api/projects/:id がある前提
  const p = await api(`/api/projects/${projectId}`, { method: "GET" });
  const title = p.title ?? "(無題)";
  const status = p.status ?? "";
  const start = p.usage_start_at ?? p.usage_start ?? "";
  const end = p.usage_end_at ?? p.usage_end ?? "";
  const html = `
    <div><b>案件:</b> ${escapeHtml(title)}</div>
    <div><b>状態:</b> ${escapeHtml(status)}</div>
    <div><b>使用:</b> ${escapeHtml(start)} 〜 ${escapeHtml(end)}</div>
    <div style="margin-top:8px">
      <a href="/project-edit.html?project_id=${projectId}">編集画面へ</a>
      &nbsp;|&nbsp;
      <a href="/calendar.html?mode=week">カレンダーへ</a>
    </div>
  `;
  document.getElementById("projectInfo").innerHTML = html;
}

async function loadEquipmentList() {
  const list = await api("/api/equipment", { method: "GET" });
  const sel = document.getElementById("equipmentSelect");
  sel.innerHTML = "";
  for (const e of list) {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = `${e.name}（在庫:${e.total_quantity}）`;
    sel.appendChild(opt);
  }
}

async function loadItems(projectId) {
  const items = await api(`/api/project-items?project_id=${projectId}`, { method: "GET" });

  if (!items.length) {
    document.getElementById("itemsWrap").innerHTML = "割当はまだありません。";
    return;
  }

  const rows = items.map(it => {
    return `
      <tr>
        <td>${escapeHtml(it.equipment_name)}</td>
        <td style="width:140px">
          <input type="number" min="1" value="${it.quantity}" data-id="${it.id}" class="qtyEdit" style="width:110px" />
        </td>
        <td style="width:210px">
          <button data-id="${it.id}" class="saveBtn">数量保存</button>
          <button data-id="${it.id}" class="delBtn">削除</button>
        </td>
      </tr>
    `;
  }).join("");

  document.getElementById("itemsWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>機材</th>
          <th>数量</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  for (const btn of document.querySelectorAll(".saveBtn")) {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const input = document.querySelector(`.qtyEdit[data-id="${id}"]`);
      const qty = Number(input.value);
      await api(`/api/project-items/${id}`, {
        method: "PUT",
        body: JSON.stringify({ quantity: qty })
      });
      await loadItems(projectId);
    });
  }

  for (const btn of document.querySelectorAll(".delBtn")) {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await api(`/api/project-items/${id}`, { method: "DELETE" });
      await loadItems(projectId);
    });
  }
}

async function addItem(projectId) {
  const equipmentId = Number(document.getElementById("equipmentSelect").value);
  const qty = Number(document.getElementById("qtyInput").value);
  const msg = document.getElementById("addMsg");
  msg.textContent = "";

  await api("/api/project-items", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      equipment_id: equipmentId,
      quantity: qty
    })
  });

  msg.textContent = "追加しました。";
  await loadItems(projectId);
}

async function main() {
  const projectId = Number(qs("project_id"));
  if (!projectId) {
    document.body.innerHTML = "project_id がありません。URLに ?project_id=数字 を付けて開いてください。";
    return;
  }

  document.getElementById("backBtn").addEventListener("click", () => history.back());
  document.getElementById("addBtn").addEventListener("click", () => addItem(projectId));

  await loadProject(projectId);
  await loadEquipmentList();
  await loadItems(projectId);
}

main().catch(err => {
  alert(err.message);
});