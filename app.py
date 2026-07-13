import io
import os
import json
import time
from flask import Flask, render_template, request, jsonify, Response, send_file
from wps_api import WPSClient

app = Flask(__name__)


def get_client():
    wps_sid = request.headers.get("X-WPS-SID", "")
    csrf = request.headers.get("X-WPS-CSRF", "")
    if not wps_sid:
        return None
    return WPSClient(wps_sid, csrf)


def err(code, msg):
    return jsonify({"error": msg}), code


def collect_group_files(client, group_id, group_name, parent_id=0, path_prefix="", seen=None):
    """递归收集组内所有文件"""
    if seen is None:
        seen = {}
    files = client.list_files(group_id, parent_id)
    if isinstance(files, dict) and "error" in files:
        return []
    result = []
    for f in files:
        fname = f["fname"]
        ftype = f["ftype"]
        current_path = f"{path_prefix}/{fname}" if path_prefix else fname
        if ftype == "folder":
            result.extend(collect_group_files(client, group_id, group_name, f["id"], current_path, seen))
        else:
            full_path = f"{group_name}/{current_path}"
            if full_path in seen:
                seen[full_path] += 1
                base, ext = os.path.splitext(full_path)
                full_path = f"{base}_{seen[full_path]}{ext}"
            else:
                seen[full_path] = 0
            result.append({
                "group_id": group_id,
                "file_id": f["id"],
                "name": fname,
                "type": ftype,
                "size": f.get("fsize", 0),
                "path": full_path,
                "mtime": f.get("mtime", 0),
            })
    return result


def collect_device_files(client, device_id, device_name, parent_id=0, path_prefix="", seen=None):
    """递归收集设备内所有文件"""
    if seen is None:
        seen = {}
    params = {"count": "200", "page": "1"}
    if parent_id:
        params["parentid"] = str(parent_id)
    data = client._get("https://drive.wps.cn/api", f"/v5/groups/tmp/devices/{device_id}/files", params)
    if isinstance(data, dict) and "error" in data:
        return []
    files = data.get("files", [])
    result = []
    for f in files:
        fname = f.get("fname", f.get("name", ""))
        ftype = f.get("ftype", "file")
        fid = f.get("id", f.get("fileid", 0))
        current_path = f"{path_prefix}/{fname}" if path_prefix else fname
        if ftype == "folder":
            result.extend(collect_device_files(client, device_id, device_name, fid, current_path, seen))
        else:
            full_path = f"设备文档/{device_name}/{current_path}"
            # 去重：同名文件加后缀
            if full_path in seen:
                seen[full_path] += 1
                base, ext = os.path.splitext(full_path)
                full_path = f"{base}_{seen[full_path]}{ext}"
            else:
                seen[full_path] = 0
            result.append({
                "group_id": 928088999,
                "file_id": fid,
                "name": fname,
                "type": ftype,
                "size": f.get("fsize", 0),
                "path": full_path,
                "mtime": f.get("mtime", 0),
            })
    return result


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/login", methods=["POST"])
def login():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    user = client.get_userinfo()
    if "error" in user:
        return err(401, user.get("message", "登录失败"))
    space = client.get_space_info()
    return jsonify({
        "user": {
            "id": user.get("id"),
            "name": user.get("name"),
            "avatar": user.get("avatar"),
            "vip": user.get("vipinfo", {}).get("name", ""),
        },
        "space": {
            "total": space.get("total", 0),
            "used": space.get("used", 0),
        } if isinstance(space, dict) and "error" not in space else None,
    })


@app.route("/api/groups")
def groups():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    result = client.get_cloud_groups()
    return jsonify({"groups": list(result.values())})


@app.route("/api/files")
def files():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    group_id = request.args.get("group_id", type=int)
    parent_id = request.args.get("parent_id", 0, type=int)
    if not group_id:
        return err(400, "缺少 group_id")
    result = client.list_files(group_id, parent_id)
    if isinstance(result, dict) and "error" in result:
        return err(400, result.get("message", "获取文件列表失败"))
    return jsonify({"files": result})


@app.route("/api/file-tree")
def file_tree():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    group_id = request.args.get("group_id", type=int)
    if not group_id:
        return err(400, "缺少 group_id")
    tree = client.get_file_tree(group_id)
    return jsonify({"tree": tree})


@app.route("/api/devices")
def devices():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    devs = client.get_devices()
    if isinstance(devs, dict) and "error" in devs:
        return err(400, devs.get("message", "获取设备列表失败"))
    return jsonify({"devices": devs})


@app.route("/api/roaming")
def roaming():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    count = request.args.get("count", 100, type=int)
    device_id = request.args.get("device_id")
    data = client.get_roaming_files(count, device_id)
    if isinstance(data, dict) and "error" in data:
        return err(400, data.get("message", "获取最近文件失败"))
    return jsonify(data)


@app.route("/api/device-list")
def device_list():
    """获取自动上传文档中的设备列表"""
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    devs = client.get_device_list()
    if isinstance(devs, dict) and "error" in devs:
        return err(400, devs.get("message", "获取设备列表失败"))
    return jsonify({"devices": devs})


@app.route("/api/device-files")
def device_files():
    """获取某个设备下的文件"""
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    device_id = request.args.get("device_id", type=int)
    parent_id = request.args.get("parent_id", 0, type=int)
    if not device_id:
        return err(400, "缺少 device_id")
    # 如果指定了 parent_id，获取子文件
    if parent_id:
        params = {"parentid": str(parent_id), "count": "200", "page": "1"}
        data = client._get("https://drive.wps.cn/api", f"/v5/groups/tmp/devices/{device_id}/files", params)
        if isinstance(data, dict) and "error" in data:
            return err(400, data.get("message"))
        files = data.get("files", [])
    else:
        files = client.get_device_files_all(device_id)
        if isinstance(files, dict) and "error" in files:
            return err(400, files.get("message"))
    return jsonify({"files": files})


@app.route("/api/device-tree")
def device_tree():
    """获取设备文件树"""
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    device_id = request.args.get("device_id", type=int)
    if not device_id:
        return err(400, "缺少 device_id")
    tree = client.get_device_file_tree(device_id)
    return jsonify({"tree": tree})


@app.route("/api/download")
def download():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    group_id = request.args.get("group_id", type=int)
    file_id = request.args.get("file_id", type=int)
    filename = request.args.get("filename", "")
    if not group_id or not file_id:
        return err(400, "缺少参数")
    content, fname = client.download_file(group_id, file_id)
    if content is None:
        return err(500, fname or "下载失败")
    fname = fname or filename or f"file_{file_id}"
    return send_file(io.BytesIO(content), as_attachment=True, download_name=fname, mimetype="application/octet-stream")


@app.route("/api/batch-download-zip", methods=["POST"])
def batch_download_zip():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    data = request.get_json()
    items = data.get("items", [])
    if not items:
        return err(400, "没有选择文件")
    buf = io.BytesIO()
    import zipfile
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in items:
            group_id = item.get("group_id")
            file_id = item.get("file_id")
            path = item.get("path", item.get("name", f"file_{file_id}"))
            content, _ = client.download_file(group_id, file_id)
            if content:
                zf.writestr(path, content)
    buf.seek(0)
    ts = time.strftime("%Y%m%d_%H%M%S")
    return send_file(buf, as_attachment=True, download_name=f"wps_backup_{ts}.zip", mimetype="application/zip")


@app.route("/api/batch-progress", methods=["POST"])
def batch_progress():
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")
    data = request.get_json()
    items = data.get("items", [])
    if not items:
        return err(400, "没有选择文件")

    def generate():
        total = len(items)
        for i, item in enumerate(items):
            group_id = item.get("group_id")
            file_id = item.get("file_id")
            name = item.get("name", f"file_{file_id}")
            content, fname = client.download_file(group_id, file_id)
            status = "ok" if content else "error"
            msg = "" if content else (fname or "下载失败")
            yield f"data: {json.dumps({'current': i + 1, 'total': total, 'file': name, 'status': status, 'msg': msg}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'done': True, 'total': total})}\n\n"

    return Response(generate(), mimetype="text/event-stream")


@app.route("/api/collect-all-files")
def collect_all_files():
    """收集所有云文档 + 设备文档的文件列表"""
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")

    all_files = []
    seen = {}  # 全局去重
    groups = client.get_cloud_groups()
    for gid, ginfo in groups.items():
        group_name = ginfo["name"]
        group_id = ginfo["id"]
        files = collect_group_files(client, group_id, group_name, seen=seen)
        all_files.extend(files)

    # 设备文档
    devices = client.get_device_list()
    if isinstance(devices, list):
        for d in devices:
            did = d["id"]
            dname = f"{d['name']}_{d.get('detail', '')}".rstrip("_")
            dname = dname.replace("/", "_").replace("\\", "_")
            dev_files = collect_device_files(client, did, dname, seen=seen)
            all_files.extend(dev_files)

    total_size = sum(f["size"] for f in all_files)

    # 最终去重：同名文件加后缀
    path_count = {}
    for f in all_files:
        p = f["path"]
        if p in path_count:
            path_count[p] += 1
            base, ext = os.path.splitext(p)
            f["path"] = f"{base}_{path_count[p]}{ext}"
        else:
            path_count[p] = 0

    return jsonify({
        "files": all_files,
        "total": len(all_files),
        "total_size": total_size,
    })


@app.route("/api/download-all", methods=["POST"])
def download_all():
    """一键下载全部文档，SSE 流式返回进度，最后返回验证结果"""
    client = get_client()
    if not client:
        return err(400, "缺少 wps_sid")

    def generate():
        import zipfile

        # 1. 收集所有文件
        yield f"data: {json.dumps({'phase': 'collect', 'msg': '正在扫描文件...'}, ensure_ascii=False)}\n\n"

        all_files = []
        seen = {}
        groups = client.get_cloud_groups()
        for gid, ginfo in groups.items():
            group_name = ginfo["name"]
            group_id = ginfo["id"]
            files = collect_group_files(client, group_id, group_name, seen=seen)
            all_files.extend(files)

        # 设备文档
        yield f"data: {json.dumps({'phase': 'collect', 'msg': '正在扫描设备文档...'}, ensure_ascii=False)}\n\n"
        devices = client.get_device_list()
        if isinstance(devices, list):
            for d in devices:
                did = d["id"]
                dname = f"{d['name']}_{d.get('detail', '')}".rstrip("_").replace("/", "_").replace("\\", "_")
                yield f"data: {json.dumps({'phase': 'collect', 'msg': f'扫描设备: {dname}'}, ensure_ascii=False)}\n\n"
                dev_files = collect_device_files(client, did, dname, seen=seen)
                all_files.extend(dev_files)

        total = len(all_files)
        total_size = sum(f["size"] for f in all_files)

        # 最终去重
        path_count = {}
        for f in all_files:
            p = f["path"]
            if p in path_count:
                path_count[p] += 1
                base, ext = os.path.splitext(p)
                f["path"] = f"{base}_{path_count[p]}{ext}"
            else:
                path_count[p] = 0

        yield f"data: {json.dumps({'phase': 'collect_done', 'total': total, 'total_size': total_size, 'msg': f'共 {total} 个文件，{total_size / 1024 / 1024:.1f} MB'}, ensure_ascii=False)}\n\n"

        if total == 0:
            yield f"data: {json.dumps({'phase': 'done', 'success': 0, 'fail': 0, 'total': 0}, ensure_ascii=False)}\n\n"
            return

        # 2. 下载并打包
        yield f"data: {json.dumps({'phase': 'download', 'msg': '开始下载...'}, ensure_ascii=False)}\n\n"

        buf = io.BytesIO()
        downloaded_names = []
        success = 0
        fail = 0
        errors = []

        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, f in enumerate(all_files):
                content, fname = client.download_file(f["group_id"], f["file_id"])
                if content:
                    zf.writestr(f["path"], content)
                    downloaded_names.append(f["path"])
                    success += 1
                else:
                    fail += 1
                    errors.append({"name": f["name"], "error": fname or "下载失败"})

                yield f"data: {json.dumps({'phase': 'progress', 'current': i + 1, 'total': total, 'file': f['name'], 'status': 'ok' if content else 'error', 'size': len(content) if content else 0}, ensure_ascii=False)}\n\n"

        # 3. 验证：对比线上列表和 ZIP 内容
        yield f"data: {json.dumps({'phase': 'verify', 'msg': '正在核对文件...'}, ensure_ascii=False)}\n\n"

        online_set = set(f["path"] for f in all_files)
        downloaded_set = set(downloaded_names)

        missing = online_set - downloaded_set   # 线上有但没下载到的
        extra = downloaded_set - online_set      # 下载了但线上没有的（理论上不会有）

        verify_result = {
            "online_count": len(all_files),
            "downloaded_count": len(downloaded_names),
            "missing_count": len(missing),
            "extra_count": len(extra),
            "missing_files": sorted(list(missing))[:50],  # 最多显示50个
            "match": len(missing) == 0 and len(extra) == 0,
        }

        # 4. 发送 ZIP
        buf.seek(0)
        zip_data = buf.getvalue()
        zip_b64 = __import__("base64").b64encode(zip_data).decode()

        yield f"data: {json.dumps({'phase': 'done', 'success': success, 'fail': fail, 'total': total, 'zip_size': len(zip_data), 'verify': verify_result, 'errors': errors[:20]}, ensure_ascii=False)}\n\n"

        # 5. 发送 ZIP 数据（base64）
        yield f"data: {json.dumps({'phase': 'zip', 'data': zip_b64}, ensure_ascii=False)}\n\n"

    return Response(generate(), mimetype="text/event-stream")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5800))
    print(f"\n  WPS 云文档下载工具  http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
