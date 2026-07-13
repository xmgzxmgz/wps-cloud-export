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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5800))
    print(f"\n  WPS 云文档下载工具  http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
