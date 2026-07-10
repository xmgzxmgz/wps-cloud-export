# WPS Cloud Export

批量导出 WPS/金山文档云文档到本地的 Web 工具。

## 功能

- 📄 **云文档下载** — 我的云文档、自动上传文档，递归遍历所有文件夹
- 💻 **设备文档下载** — 最近打开的文件，按来源设备分组
- 📦 **批量打包** — 勾选文件后打包为 ZIP 下载
- 🔐 **Cookie 登录** — 从浏览器获取 wps_sid 即可使用，无需安装任何软件
- 🐳 **Docker 部署** — 一行命令启动

## 快速开始

### 方式 1: Docker（推荐）

```bash
docker compose up -d
```

打开 http://localhost:5800

### 方式 2: 直接运行

```bash
pip install -r requirements.txt
python app.py
```

## 获取 Cookie

1. 用 Chrome 打开 [www.kdocs.cn](https://www.kdocs.cn) 并登录
2. 按 `F12` 打开开发者工具
3. 切到 **Application** → **Cookies** → **kdocs.cn**
4. 找到 `wps_sid`，复制它的值
5. （可选）也复制 `csrf` 的值

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 验证登录状态 |
| `/api/groups` | GET | 获取云文档组 |
| `/api/files` | GET | 获取文件列表 |
| `/api/file-tree` | GET | 获取文件树 |
| `/api/devices` | GET | 获取设备列表 |
| `/api/roaming` | GET | 获取最近文件 |
| `/api/download` | GET | 下载单个文件 |
| `/api/batch-download-zip` | POST | 批量下载 ZIP |
| `/api/batch-progress` | POST | SSE 流式进度 |

## 技术栈

- **后端**: Python / Flask
- **前端**: 原生 HTML + CSS + JS
- **部署**: Docker / Gunicorn

## 注意事项

- Cookie 有效期有限，过期后需要重新获取
- 频繁下载可能触发 WPS 限流，建议适当控制下载数量
- 本工具仅供个人备份使用，请遵守 WPS 的服务条款

## License

MIT
