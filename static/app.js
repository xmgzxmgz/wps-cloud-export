// ── State ──
let state = {
    wpsSid: "",
    csrf: "",
    groups: {},
    fileTree: {},
    devices: [],
    roamingFiles: [],
    selectedFiles: new Set(),
    deviceSelectedFiles: new Set(),
};

// ── API helpers ──

function apiHeaders() {
    const h = { "Content-Type": "application/json" };
    if (state.wpsSid) h["X-WPS-SID"] = state.wpsSid;
    if (state.csrf) h["X-WPS-CSRF"] = state.csrf;
    return h;
}

async function api(path, opts = {}) {
    const resp = await fetch(path, {
        headers: apiHeaders(),
        ...opts,
    });
    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data;
}

// ── Login ──

async function doLogin() {
    const sid = document.getElementById("wps-sid").value.trim();
    const csrf = document.getElementById("csrf").value.trim();

    if (!sid) {
        alert("请输入 wps_sid");
        return;
    }

    state.wpsSid = sid;
    state.csrf = csrf;

    const btn = document.getElementById("btn-login");
    btn.disabled = true;
    btn.textContent = "验证中...";

    try {
        const data = await api("/api/login");
        showMainPanel(data);
    } catch (e) {
        alert("登录失败: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "登录";
    }
}

function showMainPanel(data) {
    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("main-section").classList.remove("hidden");

    const user = data.user;
    document.getElementById("user-name").textContent = user.name;
    if (user.avatar) {
        document.getElementById("user-avatar").src = user.avatar;
    }
    if (user.vip) {
        document.getElementById("user-vip").textContent = user.vip;
    }

    if (data.space) {
        document.getElementById("storage-info").textContent =
            `${formatSize(data.space.used)} / ${formatSize(data.space.total)}`;
    }

    loadGroups();
    loadDevices();
}

function logout() {
    state.wpsSid = "";
    state.csrf = "";
    document.getElementById("login-section").classList.remove("hidden");
    document.getElementById("main-section").classList.add("hidden");
}

function toggleHelp() {
    document.getElementById("help-content").classList.toggle("hidden");
}

// ── Groups ──

async function loadGroups() {
    try {
        const data = await api("/api/groups");
        const select = document.getElementById("group-select");
        select.innerHTML = '<option value="">选择文档组...</option>';

        data.groups.forEach(g => {
            state.groups[g.id] = g;
            const opt = document.createElement("option");
            opt.value = g.id;
            opt.textContent = g.name;
            select.appendChild(opt);
        });

        // 自动选择第一个
        if (data.groups.length > 0) {
            select.value = data.groups[0].id;
            loadGroupFiles();
        }
    } catch (e) {
        console.error("加载文档组失败:", e);
    }
}

// ── Cloud files ──

async function loadGroupFiles() {
    const groupId = document.getElementById("group-select").value;
    if (!groupId) return;

    const tree = document.getElementById("file-tree");
    tree.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const data = await api(`/api/file-tree?group_id=${groupId}`);
        state.fileTree[groupId] = data.tree;
        state.selectedFiles.clear();
        renderTree(data.tree, tree, groupId, "");
        updateSelectedCount();
    } catch (e) {
        tree.innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
    }
}

function renderTree(nodes, container, groupId, parentPath) {
    container.innerHTML = "";

    if (!nodes || nodes.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>空文件夹</p></div>';
        return;
    }

    // 排序: 文件夹在前
    const sorted = [...nodes].sort((a, b) => {
        if (a.type === "folder" && b.type !== "folder") return -1;
        if (a.type !== "folder" && b.type === "folder") return 1;
        return a.name.localeCompare(b.name);
    });

    sorted.forEach(node => {
        const el = createTreeNode(node, groupId, parentPath);
        container.appendChild(el);
    });
}

function createTreeNode(node, groupId, parentPath) {
    const div = document.createElement("div");
    div.className = "tree-node";
    div.dataset.id = node.id;

    const isFolder = node.type === "folder";
    const filePath = parentPath ? `${parentPath}/${node.name}` : node.name;
    const fileKey = `${groupId}:${node.id}`;

    const row = document.createElement("div");
    row.className = "tree-row";

    // Toggle arrow
    const toggle = document.createElement("span");
    toggle.className = `tree-toggle ${isFolder ? "" : "leaf"}`;
    toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
    row.appendChild(toggle);

    // Checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "tree-checkbox";
    cb.checked = state.selectedFiles.has(fileKey);
    cb.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleSelect(node, groupId, filePath, cb.checked);
    });
    row.appendChild(cb);

    // Icon
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.innerHTML = isFolder
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
        : getFileIcon(node.type);
    row.appendChild(icon);

    // Name
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = node.name;
    name.title = node.name;
    row.appendChild(name);

    // Meta
    const meta = document.createElement("span");
    meta.className = "tree-meta";
    if (isFolder) {
        const count = node.children ? node.children.length : 0;
        meta.textContent = `${count} 项`;
    } else {
        meta.textContent = formatSize(node.size);
    }
    row.appendChild(meta);

    div.appendChild(row);

    // Children container
    if (isFolder && node.children && node.children.length > 0) {
        const childContainer = document.createElement("div");
        childContainer.className = "tree-children collapsed";
        node.children.forEach(child => {
            childContainer.appendChild(createTreeNode(child, groupId, filePath));
        });
        div.appendChild(childContainer);

        // Toggle click
        row.addEventListener("click", (e) => {
            if (e.target.tagName === "INPUT") return;
            const isOpen = !childContainer.classList.contains("collapsed");
            childContainer.classList.toggle("collapsed");
            toggle.classList.toggle("open", !isOpen);
        });
    }

    return div;
}

function toggleSelect(node, groupId, filePath, checked) {
    const fileKey = `${groupId}:${node.id}`;

    if (checked) {
        state.selectedFiles.add(fileKey);
        // 选中文件夹时选中所有子文件
        if (node.type === "folder" && node.children) {
            selectChildren(node.children, groupId, filePath, true);
        }
    } else {
        state.selectedFiles.delete(fileKey);
        if (node.type === "folder" && node.children) {
            selectChildren(node.children, groupId, filePath, false);
        }
    }

    // 更新父节点状态
    updateParentCheckbox(node, groupId);
    updateSelectedCount();
    syncCheckboxes();
}

function selectChildren(children, groupId, parentPath, checked) {
    children.forEach(child => {
        const key = `${groupId}:${child.id}`;
        const path = `${parentPath}/${child.name}`;
        if (checked) {
            state.selectedFiles.add(key);
        } else {
            state.selectedFiles.delete(key);
        }
        if (child.children) {
            selectChildren(child.children, groupId, path, checked);
        }
    });
}

function updateParentCheckbox(node, groupId) {
    // 简化处理，不递归更新父级
}

function syncCheckboxes() {
    document.querySelectorAll(".tree-checkbox").forEach(cb => {
        const node = cb.closest(".tree-node");
        if (!node) return;
        // 从 DOM 找到对应的 key
    });
}

function updateSelectedCount() {
    const count = state.selectedFiles.size;
    document.getElementById("selected-count").textContent = `已选 ${count} 个文件`;
    document.getElementById("btn-download").disabled = count === 0;
}

function expandAll() {
    document.querySelectorAll(".tree-children").forEach(el => {
        el.classList.remove("collapsed");
    });
    document.querySelectorAll(".tree-toggle").forEach(el => {
        if (!el.classList.contains("leaf")) el.classList.add("open");
    });
}

function collapseAll() {
    document.querySelectorAll(".tree-children").forEach(el => {
        el.classList.add("collapsed");
    });
    document.querySelectorAll(".tree-toggle").forEach(el => {
        el.classList.remove("open");
    });
}

function selectAll() {
    const groupId = document.getElementById("group-select").value;
    if (!groupId || !state.fileTree[groupId]) return;
    selectAllInTree(state.fileTree[groupId], groupId, "");
    syncAllCheckboxes(true);
    updateSelectedCount();
}

function selectAllInTree(nodes, groupId, parentPath) {
    nodes.forEach(node => {
        state.selectedFiles.add(`${groupId}:${node.id}`);
        if (node.children) {
            selectAllInTree(node.children, groupId, `${parentPath}/${node.name}`);
        }
    });
}

function deselectAll() {
    state.selectedFiles.clear();
    syncAllCheckboxes(false);
    updateSelectedCount();
}

function syncAllCheckboxes(checked) {
    document.querySelectorAll(".tree-checkbox").forEach(cb => {
        cb.checked = checked;
    });
}

// ── Devices ──

async function loadDevices() {
    try {
        const data = await api("/api/devices");
        state.devices = data.devices || [];
        const select = document.getElementById("device-select");
        state.devices.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.deviceid;
            opt.textContent = `${d.name} (${d.platform})`;
            select.appendChild(opt);
        });
        loadDeviceFiles();
    } catch (e) {
        console.error("加载设备失败:", e);
    }
}

async function loadDeviceFiles() {
    const container = document.getElementById("device-files");
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const deviceId = document.getElementById("device-select").value;

    try {
        const params = deviceId ? `?device_id=${deviceId}&count=200` : "?count=200";
        const data = await api(`/api/roaming${params}`);
        state.roamingFiles = data.list || [];
        state.deviceSelectedFiles.clear();
        renderDeviceFiles(state.roamingFiles);
        updateDeviceSelectedCount();
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
    }
}

function renderDeviceFiles(items) {
    const container = document.getElementById("device-files");
    container.innerHTML = "";

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>没有文件</p></div>';
        return;
    }

    items.forEach((item, index) => {
        const roaming = item.roaming || {};
        const file = item.file || {};
        const name = roaming.name || `file_${file.fileid}`;
        const device = roaming.original_device_name || "未知设备";
        const size = roaming.size || 0;

        const div = document.createElement("div");
        div.className = "file-item";
        div.innerHTML = `
            <input type="checkbox" data-index="${index}"
                   onchange="toggleDeviceSelect(${index}, this.checked)"
                   ${state.deviceSelectedFiles.has(index) ? "checked" : ""}>
            <span class="tree-icon">${getFileIcon(file.ftype || "file")}</span>
            <span class="file-name" title="${escapeHtml(roaming.path || name)}">${escapeHtml(name)}</span>
            <span class="file-device">${escapeHtml(device)}</span>
            <span class="file-size">${formatSize(size)}</span>
        `;
        container.appendChild(div);
    });
}

function toggleDeviceSelect(index, checked) {
    if (checked) {
        state.deviceSelectedFiles.add(index);
    } else {
        state.deviceSelectedFiles.delete(index);
    }
    updateDeviceSelectedCount();
}

function updateDeviceSelectedCount() {
    const count = state.deviceSelectedFiles.size;
    document.getElementById("device-selected-count").textContent = `已选 ${count} 个文件`;
    document.getElementById("btn-download-device").disabled = count === 0;
}

function selectAllDevice() {
    state.roamingFiles.forEach((_, i) => state.deviceSelectedFiles.add(i));
    document.querySelectorAll("#device-files input[type=checkbox]").forEach(cb => cb.checked = true);
    updateDeviceSelectedCount();
}

function deselectAllDevice() {
    state.deviceSelectedFiles.clear();
    document.querySelectorAll("#device-files input[type=checkbox]").forEach(cb => cb.checked = false);
    updateDeviceSelectedCount();
}

// ── Download ──

async function downloadSelected() {
    const groupId = document.getElementById("group-select").value;
    if (!groupId) return;

    const items = collectSelectedFiles(state.fileTree[groupId], groupId, "");
    if (items.length === 0) {
        alert("没有选中文件");
        return;
    }

    await doBatchDownload(items);
}

function collectSelectedFiles(nodes, groupId, parentPath) {
    if (!nodes) return [];
    let result = [];
    nodes.forEach(node => {
        const key = `${groupId}:${node.id}`;
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        if (state.selectedFiles.has(key) && node.type !== "folder") {
            result.push({
                group_id: parseInt(groupId),
                file_id: node.id,
                name: node.name,
                path: path,
            });
        }
        if (node.children) {
            result = result.concat(collectSelectedFiles(node.children, groupId, path));
        }
    });
    return result;
}

async function downloadDeviceSelected() {
    const items = [];
    state.deviceSelectedFiles.forEach(index => {
        const item = state.roamingFiles[index];
        if (!item) return;
        const roaming = item.roaming || {};
        const file = item.file || {};
        items.push({
            group_id: file.groupid || roaming.groupid,
            file_id: file.fileid || parseInt(roaming.fileid),
            name: roaming.name || `file_${file.fileid}`,
            path: roaming.name || `file_${file.fileid}`,
        });
    });

    if (items.length === 0) {
        alert("没有选中文件");
        return;
    }

    await doBatchDownload(items);
}

async function doBatchDownload(items) {
    const modal = document.getElementById("download-modal");
    const progressFill = document.getElementById("progress-fill");
    const progressText = document.getElementById("progress-text");
    const progressLog = document.getElementById("progress-log");
    const downloadResult = document.getElementById("download-result");

    modal.classList.remove("hidden");
    progressFill.style.width = "0%";
    progressText.textContent = `准备下载 ${items.length} 个文件...`;
    progressLog.innerHTML = "";
    downloadResult.classList.add("hidden");

    // 使用 SSE 流式下载
    try {
        const resp = await fetch("/api/batch-progress", {
            method: "POST",
            headers: apiHeaders(),
            body: JSON.stringify({ items }),
        });

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6);
                try {
                    const data = JSON.parse(jsonStr);
                    if (data.done) {
                        progressText.textContent = `完成! 共 ${data.total} 个文件`;
                        progressFill.style.width = "100%";
                        // 触发 ZIP 下载
                        triggerZipDownload(items);
                        return;
                    }

                    const pct = Math.round((data.current / data.total) * 100);
                    progressFill.style.width = `${pct}%`;
                    progressText.textContent = `${data.current}/${data.total} - ${data.file}`;

                    const cls = data.status === "ok" ? "log-ok" : "log-error";
                    const icon = data.status === "ok" ? "✓" : "✗";
                    progressLog.innerHTML += `<div class="${cls}">${icon} ${escapeHtml(data.file)} ${data.msg || ""}</div>`;
                    progressLog.scrollTop = progressLog.scrollHeight;
                } catch (e) {
                    // skip
                }
            }
        }
    } catch (e) {
        progressText.textContent = "下载出错: " + e.message;
    }
}

async function triggerZipDownload(items) {
    try {
        const resp = await fetch("/api/batch-download-zip", {
            method: "POST",
            headers: apiHeaders(),
            body: JSON.stringify({ items }),
        });

        if (!resp.ok) {
            const data = await resp.json();
            alert("打包下载失败: " + (data.error || "未知错误"));
            return;
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `wps_backup_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        document.getElementById("progress-text").textContent = "下载完成！文件已保存。";
    } catch (e) {
        alert("下载失败: " + e.message);
    }
}

function closeDownloadModal() {
    document.getElementById("download-modal").classList.add("hidden");
}

// ── Tabs ──

function switchTab(tab) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector(`.tab[data-tab="${tab}"]`).classList.add("active");

    document.getElementById("panel-cloud").classList.toggle("hidden", tab !== "cloud");
    document.getElementById("panel-device").classList.toggle("hidden", tab !== "device");
}

// ── Helpers ──

function formatSize(bytes) {
    if (!bytes || bytes === 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function getFileIcon(type) {
    const icons = {
        kdoc: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        ksheet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`,
        kslide: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        file: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    };

    // 根据文件类型选择图标
    for (const [key, icon] of Object.entries(icons)) {
        if (type && type.includes(key)) return icon;
    }

    // 根据扩展名判断
    if (type === "docx" || type === "doc" || type === "pdf" || type === "txt") return icons.kdoc;
    if (type === "xlsx" || type === "xls" || type === "csv") return icons.ksheet;
    if (type === "pptx" || type === "ppt") return icons.kslide;

    return icons.file;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ── Init ──

document.addEventListener("DOMContentLoaded", () => {
    // Enter 键登录
    document.getElementById("wps-sid").addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
    });

    // 点击 modal 外部关闭
    document.getElementById("download-modal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeDownloadModal();
    });
});
