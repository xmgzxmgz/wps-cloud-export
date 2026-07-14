// ── State ──
let state = {
    wpsSid: "",
    csrf: "",
    groups: {},
    tmpGroupId: 0,
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
    const resp = await fetch(path, { headers: apiHeaders(), ...opts });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`服务器返回了非 JSON 响应 (${resp.status})`); }
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
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
        const data = await api("/api/login", { method: "POST" });
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
            if (g.type === "tmp") state.tmpGroupId = g.id;
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
        const data = await api("/api/device-list");
        state.devices = data.devices || [];
        const select = document.getElementById("device-select");
        state.devices.forEach(d => {
            const sizeStr = d.fsize ? ` (${formatSize(d.fsize)})` : "";
            const detail = d.detail ? ` - ${d.detail}` : "";
            select.innerHTML += `<option value="${d.id}">${esc(d.name)}${detail}${sizeStr}</option>`;
        });
        if (state.devices.length) loadDeviceFiles();
    } catch (e) {
        console.error("加载设备失败:", e);
    }
}

async function loadDeviceFiles() {
    const container = document.getElementById("device-files");
    container.innerHTML = '<div class="flex items-center justify-center py-20"><div class="spinner h-6 w-6 rounded-full border-2 border-muted border-t-foreground"></div></div>';

    const deviceId = document.getElementById("device-select").value;
    if (!deviceId) {
        container.innerHTML = '<div class="flex flex-col items-center justify-center py-20 text-muted-foreground"><p class="text-sm">请选择设备</p></div>';
        return;
    }

    try {
        const data = await api(`/api/device-files?device_id=${deviceId}`);
        state.deviceFiles = data.files || [];
        state.deviceSelectedFiles.clear();
        renderDeviceFiles(state.deviceFiles);
        updateDeviceSelectedCount();
    } catch (e) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center py-20 text-muted-foreground"><p class="text-sm">加载失败: ${esc(e.message)}</p></div>`;
    }
}

function renderDeviceFiles(files) {
    const container = document.getElementById("device-files");
    if (!files?.length) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center py-20 text-muted-foreground"><p class="text-sm">该设备没有文件</p></div>`;
        return;
    }

    container.innerHTML = `<div class="space-y-0.5">${files.map((f, i) => {
        const name = f.fname || f.name || `file_${f.id || f.fileid}`;
        const size = f.fsize || 0;
        const ftype = f.ftype || "file";
        const fid = f.id || f.fileid;
        const isFolder = ftype === "folder";
        return `<div class="device-row">
            <input type="checkbox" data-idx="${i}" data-id="${fid}"
                   class="h-3.5 w-3.5 rounded-sm border border-input bg-background shadow-sm accent-foreground cursor-pointer flex-shrink-0"
                   onchange="toggleDeviceSelect(${i}, this.checked)" ${state.deviceSelectedFiles.has(i) ? "checked" : ""}>
            <span class="flex-shrink-0">${isFolder ? folderIcon() : fileIcon(ftype)}</span>
            <span class="flex-1 truncate text-sm" title="${esc(name)}">${esc(name)}</span>
            <span class="flex-shrink-0 text-xs text-muted-foreground w-16 text-right">${formatSize(size)}</span>
        </div>`;
    }).join("")}</div>`;
}

function toggleDeviceSelect(idx, checked) {
    if (checked) state.deviceSelectedFiles.add(idx); else state.deviceSelectedFiles.delete(idx);
    updateDeviceSelectedCount();
}
function updateDeviceSelectedCount() {
    const n = state.deviceSelectedFiles.size;
    document.getElementById("device-selected-count").textContent = `已选 ${n} 个文件`;
    document.getElementById("btn-download-device").disabled = n === 0;
}
function selectAllDevice() {
    (state.deviceFiles || []).forEach((_, i) => state.deviceSelectedFiles.add(i));
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
        const f = (state.deviceFiles || [])[index];
        if (!f) return;
        const fid = f.id || f.fileid;
        const fname = f.fname || f.name || `file_${fid}`;
        if (f.ftype === "folder") return; // 跳过文件夹
        items.push({
            group_id: state.tmpGroupId || 0,
            file_id: fid,
            name: fname,
            path: fname,
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

function closeModal() {
    document.getElementById("download-modal").classList.add("hidden");
    document.getElementById("verify-report").classList.add("hidden");
}

// ── Download All (逐个下载到本地文件夹，支持增量) ──

async function downloadAll() {
    const btn = document.getElementById("btn-download-all");

    // 检查浏览器支持
    if (!window.showDirectoryPicker) {
        alert("你的浏览器不支持 File System Access API，请使用 Chrome 或 Edge");
        return;
    }

    // 1. 让用户选择本地文件夹
    let dirHandle;
    try {
        dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (e) {
        return; // 用户取消
    }

    btn.disabled = true;
    btn.textContent = "扫描中...";

    const modal = document.getElementById("download-modal");
    const fill = document.getElementById("progress-fill");
    const text = document.getElementById("progress-text");
    const sub = document.getElementById("progress-subtitle");
    const log = document.getElementById("progress-log");
    const verifyReport = document.getElementById("verify-report");
    const verifyContent = document.getElementById("verify-content");
    const title = document.getElementById("modal-title");

    modal.classList.remove("hidden");
    title.textContent = "一键下载全部";
    fill.style.width = "0%";
    fill.className = "h-full w-0 rounded-full bg-foreground progress-stripe transition-all duration-300";
    text.textContent = "";
    sub.textContent = "正在获取云端文件列表...";
    log.innerHTML = "";
    verifyReport.classList.add("hidden");
    verifyContent.innerHTML = "";

    try {
        // 2. 获取云端文件列表
        const cloudData = await api("/api/collect-all-files");
        const cloudFiles = cloudData.files;
        log.innerHTML += `<div class="text-muted-foreground">📁 云端共 ${cloudFiles.length} 个文件，${formatSize(cloudData.total_size)}</div>`;

        // 3. 扫描本地目录，找出已存在的文件
        sub.textContent = "正在扫描本地文件...";
        const localFiles = new Set();
        await scanLocalDir(dirHandle, "", localFiles);
        log.innerHTML += `<div class="text-muted-foreground">📂 本地已有 ${localFiles.size} 个文件</div>`;

        // 4. 对比，找出缺失文件
        const missing = cloudFiles.filter(f => !localFiles.has(f.path));
        log.innerHTML += `<div class="text-blue-400">🔍 缺失 ${missing.length} 个文件，跳过 ${cloudFiles.length - missing.length} 个</div>`;

        if (missing.length === 0) {
            sub.textContent = "全部文件已存在，无需下载";
            fill.style.width = "100%";
            fill.classList.remove("progress-stripe");
            verifyReport.classList.remove("hidden");
            verifyContent.innerHTML = `<div class="text-emerald-400">✅ 全部 ${cloudFiles.length} 个文件已同步</div>`;
            btn.disabled = false;
            btn.innerHTML = downloadAllBtnHtml();
            return;
        }

        // 5. 逐个下载缺失文件（并发 3 个）
        sub.textContent = `开始下载 ${missing.length} 个文件...`;
        let success = 0, fail = 0;
        const errors = [];
        const CONCURRENCY = 3;
        let idx = 0;

        async function downloadOne() {
            while (idx < missing.length) {
                const i = idx++;
                const f = missing[i];
                try {
                    await downloadFileToLocal(dirHandle, f);
                    success++;
                    const pct = Math.round(((success + fail) / missing.length) * 100);
                    fill.style.width = pct + "%";
                    text.textContent = `${success + fail} / ${missing.length}`;
                    sub.textContent = f.name;
                    log.innerHTML += `<div class="text-emerald-400">✓ ${esc(f.path)}</div>`;
                } catch (e) {
                    fail++;
                    errors.push({ name: f.name, error: e.message });
                    log.innerHTML += `<div class="text-red-400">✗ ${esc(f.path)} — ${esc(e.message)}</div>`;
                }
                log.scrollTop = log.scrollHeight;
            }
        }

        const workers = [];
        for (let w = 0; w < CONCURRENCY; w++) workers.push(downloadOne());
        await Promise.all(workers);

        // 6. 保存清单文件
        const manifest = {
            timestamp: new Date().toISOString(),
            total: cloudFiles.length,
            downloaded: success,
            failed: fail,
            files: cloudFiles.map(f => f.path),
        };
        await writeJsonFile(dirHandle, "_wps_manifest.json", manifest);

        // 7. 完成
        fill.classList.remove("progress-stripe");
        fill.style.width = "100%";
        sub.textContent = `完成：成功 ${success}，失败 ${fail}，跳过 ${cloudFiles.length - missing.length}`;

        verifyReport.classList.remove("hidden");
        verifyContent.innerHTML = `
            <div class="flex justify-between"><span>云端文件</span><span class="font-mono">${cloudFiles.length}</span></div>
            <div class="flex justify-between"><span>本地已有</span><span class="font-mono">${cloudFiles.length - missing.length}</span></div>
            <div class="flex justify-between"><span>本次下载</span><span class="font-mono text-emerald-400">${success}</span></div>
            <div class="flex justify-between"><span>失败</span><span class="font-mono ${fail > 0 ? 'text-red-400' : ''}">${fail}</span></div>
            <div class="mt-2 font-medium">${fail === 0 ? '✅ 全部下载成功' : `⚠️ ${fail} 个文件下载失败`}</div>
        `;

        if (errors.length) {
            log.innerHTML += `<div class="text-red-400 mt-2">失败列表：</div>`;
            errors.slice(0, 20).forEach(e => {
                log.innerHTML += `<div class="text-red-400">  ✗ ${esc(e.name)}</div>`;
            });
        }

    } catch (e) {
        sub.textContent = "出错: " + e.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = downloadAllBtnHtml();
    }
}

function downloadAllBtnHtml() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 一键下载全部`;
}

// 递归扫描本地目录
async function scanLocalDir(dirHandle, prefix, fileSet) {
    for await (const [name, handle] of dirHandle.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "file") {
            fileSet.add(path);
        } else if (handle.kind === "directory" && !name.startsWith(".")) {
            await scanLocalDir(handle, path, fileSet);
        }
    }
}

// 下载单个文件到本地目录
async function downloadFileToLocal(rootHandle, file) {
    // 确保子目录存在
    const parts = file.path.split("/");
    let currentHandle = rootHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: true });
    }

    const fileName = parts[parts.length - 1];
    const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });

    // 从服务器下载
    const url = `/api/download?group_id=${file.group_id}&file_id=${file.file_id}&sid=${encodeURIComponent(state.wpsSid)}&csrf=${encodeURIComponent(state.csrf)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob();
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

// 写 JSON 文件到本地目录
async function writeJsonFile(dirHandle, name, data) {
    try {
        const fileHandle = await dirHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    } catch (e) {
        console.warn("保存清单失败:", e);
    }
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

function folderIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
}

function fileIcon(type) {
    const colors = { kdoc: "#6366f1", docx: "#6366f1", doc: "#6366f1", pdf: "#ef4444", txt: "#a78bfa", ksheet: "#22c55e", xlsx: "#22c55e", xls: "#22c55e", csv: "#22c55e", kslide: "#f59e0b", pptx: "#f59e0b", ppt: "#f59e0b" };
    const c = colors[type] || "#71717a";
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
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

function esc(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}
const escapeHtml = esc;

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
