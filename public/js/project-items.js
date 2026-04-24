function qs(name) {
  return new URL(location.href).searchParams.get(name);
}

function getToken() {
  // auth.jsのauthUtils.getTokenが利用可能な場合はそちらを使う（統一）
  if (window.authUtils && typeof window.authUtils.getToken === 'function') {
    return window.authUtils.getToken() || null;
  }
  const keys = ["token", "jwt", "authToken", "access_token"];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v && String(v).trim()) return String(v).trim().replace(/^Bearer\s+/i, "");
  }
  return null;
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers || {});
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

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

async function loadProject(projectId) {
  const p = await api(`/api/projects/${projectId}`, { method: "GET" });
  const title = p.title ?? "(無題)";
  const status = p.status ?? "";
  const start = formatDate(p.usage_start_at ?? p.usage_start ?? "");
  const end = formatDate(p.usage_end_at ?? p.usage_end ?? "");
  const html = `
    <div style="font-size:18px; font-weight:bold; margin-bottom:6px">${escapeHtml(title)}</div>
    <div style="color:#6b7280; font-size:14px; margin-bottom:2px">状態: ${escapeHtml(status)}</div>
    <div style="color:#6b7280; font-size:14px; margin-bottom:8px">使用: ${escapeHtml(start)} 〜 ${escapeHtml(end)}</div>
    <div style="display:flex; gap:12px; font-size:14px">
      <a href="/project-edit.html?id=${projectId}&return=${encodeURIComponent(getReturnUrl())}">編集画面へ</a>
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

// 機材リスト（グローバル）
let allEquipment = [];

function imgOrPlaceholder(e, size = 52) {
  if (e.image_url || e.image) {
    return `<img src="${escapeHtml(e.image_url || e.image)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:8px" />`;
  }
  return `<div class="no-img" style="width:${size}px;height:${size}px">📦</div>`;
}

async function loadEquipmentList() {
  const raw = await api("/api/equipment", { method: "GET" });
  allEquipment = normalizeEquipmentPayload(raw);
  renderEquipList(allEquipment);

  // 検索
  document.getElementById("searchInput").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q ? allEquipment.filter(eq => eq.name.toLowerCase().includes(q)) : allEquipment;
    renderEquipList(filtered);
  });
}

function renderEquipList(list) {
  const wrap = document.getElementById("equipList");
  if (!list.length) {
    wrap.innerHTML = '<div style="color:#6b7280;padding:12px">機材がありません</div>';
    return;
  }

  // 固定備品とその他でグループ分け
  const normal = list.filter(e => !e.is_fixed);
  const fixed  = list.filter(e => e.is_fixed);

  let html = "";

  if (normal.length) {
    html += normal.map(e => equipItemHtml(e)).join("");
  }
  if (fixed.length) {
    html += `<div class="equip-section-header">🔧 固定備品</div>`;
    html += fixed.map(e => equipItemHtml(e)).join("");
  }

  wrap.innerHTML = html;

  // チェックボックスのイベント
  wrap.querySelectorAll(".equip-item").forEach(row => {
    const cb = row.querySelector("input[type=checkbox]");
    const qtyInput = row.querySelector("select.equip-qty");

    row.addEventListener("click", (ev) => {
      if (ev.target === qtyInput) return; // 数量欄クリックは除外
      if (ev.target === cb) return; // チェックボックス自体はそのまま
      cb.checked = !cb.checked;
      row.classList.toggle("checked", cb.checked);
    });

    cb.addEventListener("change", () => {
      row.classList.toggle("checked", cb.checked);
    });

    
  });
}

function equipItemHtml(e) {
  const stock = e.is_fixed ? "固定備品" : `在庫: ${e.total_quantity ?? 0}`;
  const max = e.is_fixed ? 10 : Math.max(10, e.total_quantity ?? 10);
  let options = `<option value="0">未定</option>`;
  for (let i = 1; i <= max; i++) options += `<option value="${i}"${i === 1 ? ' selected' : ''}>${i}</option>`;
  return `
    <div class="equip-item" data-id="${e.id}">
      <input type="checkbox" class="equip-cb" data-id="${e.id}" />
      ${imgOrPlaceholder(e, 52)}
      <div class="info">
        <div class="name">${escapeHtml(e.name)}</div>
        <div class="stock">${escapeHtml(stock)}</div>
      </div>
      <div class="qty-wrap">
        <select class="equip-qty" data-id="${e.id}" style="padding:5px 6px;font-size:14px;border:1px solid #ccc;border-radius:6px;">
          ${options}
        </select>
      </div>
    </div>
  `;
}

async function loadItems(projectId) {
  const items = await api(`/api/project-items?project_id=${projectId}`, { method: "GET" });
  const wrap = document.getElementById("itemsWrap");

  if (!items.length) {
    wrap.innerHTML = '<div style="color:#6b7280">割当はまだありません。</div>';
    return;
  }

  wrap.innerHTML = items.map(it => {
    const imgHtml = (it.image_url || it.image)
      ? `<img src="${escapeHtml(it.image_url || it.image)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px" />`
      : `<div class="no-img" style="width:48px;height:48px">📦</div>`;
    return `
      <div class="assigned-item">
        ${imgHtml}
        <div class="info">
          <div class="name">${escapeHtml(it.equipment_name)}${it.quantity === 0 ? ' <span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid #fcd34d;font-weight:600;">数量未定</span>' : ''}</div>
          <div class="qty-row">
            <span style="color:#6b7280;font-size:13px">数量:</span>
            <select class="qtyEdit" data-id="${it.id}" style="padding:4px 6px;font-size:14px;border:1px solid #ccc;border-radius:6px;${it.quantity === 0 ? 'border-color:#fcd34d;background:#fffbeb;' : ''}">
  <option value="0"${it.quantity === 0 ? ' selected' : ''}>未定</option>
  ${Array.from({length: 99}, (_, i) => i + 1).map(i => `<option value="${i}"${it.quantity === i ? ' selected' : ''}>${i}</option>`).join('')}
</select>
            <button class="btn btn-sm saveBtn" data-id="${it.id}">保存</button>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-sm btn-danger delBtn" data-id="${it.id}">削除</button>
        </div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll(".saveBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const id = btn.dataset.id;
        const input = wrap.querySelector(`.qtyEdit[data-id="${id}"]`);
        const qty = Number(input.value);
        if (!Number.isFinite(qty) || qty < 0) throw new Error("数量が不正です");
        await api(`/api/project-items/${id}`, { method: "PUT", body: JSON.stringify({ quantity: qty }) });
        await loadItems(projectId);
      } catch (e) { alert(e.message); }
    });
  });

  wrap.querySelectorAll(".delBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("削除しますか？")) return;
      try {
        await api(`/api/project-items/${btn.dataset.id}`, { method: "DELETE" });
        await loadItems(projectId);
      } catch (e) { alert(e.message); }
    });
  });
}

async function addCheckedItems(projectId) {
  const addMsg = document.getElementById("addMsg");
  const errorMsg = document.getElementById("errorMsg");
  addMsg.textContent = "";
  errorMsg.textContent = "";

  const checked = document.querySelectorAll(".equip-cb:checked");
  if (!checked.length) {
    errorMsg.textContent = "機材にチェックを入れてください。";
    return;
  }

  let successCount = 0;
  const errors = [];

  for (const cb of checked) {
    const equipmentId = Number(cb.dataset.id);
    const qtyInput = document.querySelector(`.equip-qty[data-id="${equipmentId}"]`);
    const qty = Number(qtyInput ? qtyInput.value : 1);
    if (!Number.isFinite(qty) || qty < 0) {
      errors.push(`ID:${equipmentId} 数量が不正`);
      continue;
    }

    try {
      await api("/api/project-items", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, equipment_id: equipmentId, quantity: qty })
      });
      successCount++;
    } catch (e) {
      errors.push(`${e.message}`);
    }
  }

  // チェックをリセット
  document.querySelectorAll(".equip-cb:checked").forEach(cb => {
    cb.checked = false;
    cb.closest(".equip-item")?.classList.remove("checked");
  });
  document.querySelectorAll(".equip-qty").forEach(inp => inp.value = 1);

  if (successCount > 0) addMsg.textContent = `${successCount}件追加しました。`;
  if (errors.length) errorMsg.textContent = errors.join(" / ");

  await loadItems(projectId);
}

async function main() {
  if (!getToken()) { location.href = "/index.html"; return; }

  const projectId = Number(qs("project_id"));
  if (!projectId) {
    document.body.innerHTML = "project_id がありません。";
    return;
  }

  document.getElementById("backBtn").addEventListener("click", () => { location.href = getReturnUrl(); });
  document.getElementById("addBtn").addEventListener("click", () => addCheckedItems(projectId));

  try {
    await loadProject(projectId);
    await loadEquipmentList();
    await loadItems(projectId);
  } catch (e) {
    console.error(e);
    document.getElementById("errorMsg").textContent = e.message;
  }
}

main();