"""
WPS 云文档 API 封装
通过 WPS 内部 API 实现云文档的浏览和下载
"""

import requests
import time
from urllib.parse import unquote


DRIVE_BASE = "https://drive.wps.cn/api"
ACCOUNT_BASE = "https://account.kdocs.cn"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://www.kdocs.cn",
    "Accept": "application/json, text/plain, */*",
}

MAX_RETRIES = 3


class WPSClient:
    def __init__(self, wps_sid: str, csrf: str = ""):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        cookie_str = f"wps_sid={wps_sid}"
        if csrf:
            cookie_str += f"; csrf={csrf}"
        self.session.headers["Cookie"] = cookie_str

    def _get(self, base: str, path: str, params: dict = None):
        url = f"{base}{path}"
        for attempt in range(MAX_RETRIES):
            try:
                resp = self.session.get(url, params=params, timeout=30)
                if resp.status_code == 401:
                    return {"error": "auth_failed", "message": "Cookie 已过期"}
                if resp.status_code == 403:
                    return {"error": "forbidden", "message": "访问被拒绝"}
                if resp.status_code == 404:
                    return {"error": "not_found", "message": "资源不存在"}
                resp.raise_for_status()
                ct = resp.headers.get("content-type", "")
                if "json" in ct:
                    return resp.json()
                return {"raw": resp.text}
            except requests.exceptions.RequestException as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2 ** attempt)
                else:
                    return {"error": "request_failed", "message": str(e)}
        return {"error": "max_retries"}

    def get_userinfo(self):
        return self._get(DRIVE_BASE, "/v3/userinfo")

    def get_space_info(self):
        return self._get(DRIVE_BASE, "/v3/spaces")

    def get_cloud_groups(self):
        groups = {}
        special = self._get(DRIVE_BASE, "/v3/groups/special")
        if special and special.get("id"):
            groups[str(special["id"])] = {
                "id": special["id"],
                "name": special.get("name", "我的云文档"),
                "type": "special",
            }
        tmp = self._get(DRIVE_BASE, "/v3/groups/tmp")
        if tmp and tmp.get("id"):
            groups[str(tmp["id"])] = {
                "id": tmp["id"],
                "name": tmp.get("name", "自动上传文档"),
                "type": "tmp",
            }
        return groups

    def list_files(self, group_id: int, parent_id: int = 0, page: int = 1, count: int = 200):
        params = {"parentid": parent_id, "page": page, "count": count}
        data = self._get(DRIVE_BASE, f"/v3/groups/{group_id}/files", params)
        if isinstance(data, dict) and "error" in data:
            return data
        return data.get("files", []) if isinstance(data, dict) else []

    def list_files_all(self, group_id: int, parent_id: int = 0):
        all_files = []
        page = 1
        while True:
            files = self.list_files(group_id, parent_id, page)
            if isinstance(files, dict) and "error" in files:
                return files if not all_files else all_files
            if not files:
                break
            all_files.extend(files)
            if len(files) < 200:
                break
            page += 1
        return all_files

    def get_file_tree(self, group_id: int, parent_id: int = 0, depth: int = 0, max_depth: int = 10):
        if depth > max_depth:
            return []
        files = self.list_files(group_id, parent_id)
        if isinstance(files, dict) and "error" in files:
            return []
        result = []
        for f in files:
            node = {
                "id": f["id"],
                "name": f["fname"],
                "type": f["ftype"],
                "size": f.get("fsize", 0),
                "mtime": f.get("mtime", 0),
                "group_id": group_id,
                "parent_id": parent_id,
            }
            if f["ftype"] == "folder":
                node["children"] = self.get_file_tree(group_id, f["id"], depth + 1, max_depth)
                node["child_count"] = len(node["children"])
            result.append(node)
        return result

    def get_devices(self):
        data = self._get(ACCOUNT_BASE, "/p/user/me/devices", {"trusted_device": "true"})
        if isinstance(data, dict) and "error" in data:
            return data
        return data.get("devices", []) if isinstance(data, dict) else []

    # ── 设备文档（自动上传文档组中的设备文件）──

    def get_device_list(self):
        """获取自动上传文档组中的设备列表"""
        data = self._get(DRIVE_BASE, "/v5/groups/tmp/devices", {"count": "200", "getserial": "true", "offset": "0"})
        if isinstance(data, dict) and "error" in data:
            return data
        return data.get("devices", []) if isinstance(data, dict) else []

    def get_device_files(self, device_id: int, offset: int = 0, count: int = 200):
        """获取某个设备下的文件列表"""
        params = {"count": str(count), "offset": str(offset)}
        data = self._get(DRIVE_BASE, f"/v5/groups/tmp/devices/{device_id}/files", params)
        if isinstance(data, dict) and "error" in data:
            return data
        return data.get("files", []) if isinstance(data, dict) else []

    def get_device_files_all(self, device_id: int):
        """分页获取某个设备下的所有文件"""
        all_files = []
        offset = 0
        while True:
            files = self.get_device_files(device_id, offset)
            if isinstance(files, dict) and "error" in files:
                return files if not all_files else all_files
            if not files:
                break
            all_files.extend(files)
            if len(files) < 200:
                break
            offset += len(files)
        return all_files

    def get_device_file_tree(self, device_id: int, parent_id: int = 0, depth: int = 0, max_depth: int = 10):
        """递归获取设备文件树"""
        if depth > max_depth:
            return []
        if parent_id == 0:
            self._tmp_group_id = None
            groups = self.get_cloud_groups()
            for gid, ginfo in groups.items():
                if ginfo.get("type") == "tmp":
                    self._tmp_group_id = ginfo["id"]
                    break
        params = {"parentid": str(parent_id), "count": "200", "page": "1"}
        data = self._get(DRIVE_BASE, f"/v5/groups/tmp/devices/{device_id}/files", params)
        if isinstance(data, dict) and "error" in data:
            return []
        files = data.get("files", []) if isinstance(data, dict) else []
        result = []
        for f in files:
            node = {
                "id": f.get("id", f.get("fileid", 0)),
                "name": f.get("fname", f.get("name", "")),
                "type": f.get("ftype", "file"),
                "size": f.get("fsize", 0),
                "mtime": f.get("mtime", 0),
                "group_id": self._tmp_group_id or 0,
                "parent_id": parent_id,
            }
            if node["type"] == "folder":
                node["children"] = self.get_device_file_tree(device_id, node["id"], depth + 1, max_depth)
                node["child_count"] = len(node["children"])
            result.append(node)
        return result

    # ── 旧版 roaming 接口（兼容）──

    def get_roaming_files(self, count: int = 100, device_id: str = None, mtime=None):
        params = {"count": count, "include": "group_type"}
        if device_id:
            params["deviceid"] = device_id
        if mtime:
            params["mtime"] = mtime
        return self._get(DRIVE_BASE, "/v5/roaming", params)

    def get_download_url(self, group_id: int, file_id: int):
        data = self._get(DRIVE_BASE, f"/v3/groups/{group_id}/files/{file_id}/download")
        if isinstance(data, dict) and "error" in data:
            return None
        fileinfo = data.get("fileinfo", {}) if isinstance(data, dict) else {}
        return fileinfo.get("url") or fileinfo.get("static_url")

    def download_file(self, group_id: int, file_id: int):
        """返回 (content_bytes, filename) 或 (None, error_msg)"""
        url = self.get_download_url(group_id, file_id)
        if not url:
            return None, "获取下载链接失败"
        for attempt in range(MAX_RETRIES):
            try:
                resp = self.session.get(url, stream=True, timeout=300, allow_redirects=True)
                if resp.status_code != 200:
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(2)
                        continue
                    return None, f"下载失败 HTTP {resp.status_code}"
                filename = ""
                cd = resp.headers.get("Content-Disposition", "")
                if "filename" in cd:
                    try:
                        if "filename*=" in cd:
                            fname = cd.split("filename*=UTF-8''")[-1]
                        else:
                            fname = cd.split("filename=")[-1].strip('"')
                        filename = unquote(fname).strip()
                    except Exception:
                        pass
                content = resp.content
                return content, filename or None
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2)
                else:
                    return None, str(e)
        return None, "下载失败"
