function qs(name) {
  return new URL(location.href).searchParams.get(name);
}

function getToken() {
  const keys = ["token", "jwt", "authToken", "access_token"];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v && String(v).trim()) return String(v).trim().replace(/^Bearer\s+/i, "");
  }
  return null;
}

async function api(path, options = {}) {
  const token = getToken();

  const headers = Object.assign(
    {},
    options.headers || {}
  );

  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && data.message) ? data.message : (typeof data === "string" && data ? data : `HTTP ${res.status}`);
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

function getReturnUrl() {
  return qs("return") || "/calendar.html?mode=week";
}

function showTopError(msg) {
  // project-items.html 側に専用枠が無いので、projectInfoの先頭に出す
  const info = document.getElementById("projectInfo");
  if (!info) return;
  const html = `
    <div style="padding:10px; border:1px solid #ffcccc; background:#ffefef; border-radius:10px; margin-bottom:10px;">
      ${escapeHtml(msg)}
    </div>
  `;
  info.innerHTML = html + info.innerHTML;
}

async function loadProject(projectId) {
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
      <a href="/project-edit.html?project_id=${projectId}&return=${encodeURIComponent(getReturnUrl())}">編集画面へ</a>
      &nbsp;|&nbsp;
      <a href="${escapeHtml(getReturnUrl())}">戻る</a>
    </div>
  `;
  document.getElementById("projectInfo").innerHTML = html;
}

function normalizeEquipmentPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.equipment)) return data.equipment;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function loadEquipmentList() {
  const raw = await api("/api/equipment", { method: "GET" });
  const list = normalizeEquipmentPayload(raw);

  const sel = document.getElementById("equipmentSelect");
  sel.innerHTML = "";

  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "機材がありません（先に機材登録してください）";
    sel.appendChild(opt);
    sel.disabled = true;

    const addBtn = document.getElementById("addBtn");
    const qty = document.getElementById("qtyInput");
    if (addBtn) addBtn.disabled = true;
    if (qty) qty.disabled = true;
    return;
  }

  sel.disabled = false;
  const addBtn = document.getElementById("addBtn");
  const qty = document.getElementById("qtyInput");
  if (addBtn) addBtn.disabled = false;
  if (qty) qty.disabled = false;

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
      try {
        const id = btn.getAttribute("data-id");
        const input = document.querySelector(`.qtyEdit[data-id="${id}"]`);
        const qty = Number(input.value);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("数量が不正です");
        await api(`/api/project-items/${id}`, {
          method: "PUT",
          body: JSON.stringify({ quantity: qty })
        });
        await loadItems(projectId);
      } catch (e) {
        alert(e.message);
      }
    });
  }

  for (const btn of document.querySelectorAll(".delBtn")) {
    btn.addEventListener("click", async () => {
      try {
        const id = btn.getAttribute("data-id");
        await api(`/api/project-items/${id}`, { method: "DELETE" });
        await loadItems(projectId);
      } catch (e) {
        alert(e.message);
      }
    });
  }
}

async function addItem(projectId) {
  const sel = document.getElementById("equipmentSelect");
  if (sel.disabled) return;

  const equipmentId = Number(sel.value);
  const qty = Number(document.getElementById("qtyInput").value);
  const msg = document.getElementById("addMsg");
  msg.textContent = "";

  if (!Number.isFinite(equipmentId) || equipmentId <= 0) throw new Error("機材の選択が不正です");
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("数量が不正です");

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
  if (!getToken()) {
    location.href = "/index.html";
    return;
  }

  const projectId = Number(qs("project_id"));
  if (!projectId) {
    document.body.innerHTML = "project_id がありません。URLに ?project_id=数字 を付けて開いてください。";
    return;
  }

  const backBtn = document.getElementById("backBtn");
  if (backBtn) backBtn.addEventListener("click", () => {
    location.href = getReturnUrl();
  });

  const addBtn = document.getElementById("addBtn");
  if (addBtn) addBtn.addEventListener("click", async () => {
    try {
      await addItem(projectId);
    } catch (e) {
      alert(e.message);
    }
  });

  try {
    await loadProject(projectId);
    await loadEquipmentList();
    await loadItems(projectId);
  } catch (e) {
    // 401/403/500などで「操作不能」になっている原因を画面に出す
    showTopError(e.message);
    throw e;
  }
}

main().catch(err => {
  // 既に画面に表示しているので、alertは最小限
  console.error(err);
});