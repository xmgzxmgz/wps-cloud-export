# WPS Cloud Export

批量导出 WPS / 金山文档云文档到本地的 Web 工具。

## 功能

- 📄 **云文档** — 我的云文档、自动上传文档，递归遍历文件夹，树形浏览
- 💻 **设备文档** — 按设备查看所有同步文件（PC / 手机 / 平板），支持选择下载
- 📦 **批量打包** — 勾选文件后打包为 ZIP 一键下载，实时进度
- 🔐 **Cookie 登录** — 粘贴浏览器 `wps_sid` 即可，无需安装任何软件
- 🎨 **shadcn/ui 风格** — 深色主题，现代 UI
- 🐳 **Docker 部署** — 一行命令启动

## 快速开始

### Docker（推荐）

```bash
docker compose up -d
```

打开 http://localhost:5800

### 直接运行

```bash
pip install -r requirements.txt
python app.py
```

## 获取 Cookie

1. Chrome 打开 [www.kdocs.cn](https://www.kdocs.cn) 并登录
2. 按 `F12` → **Application** → **Cookies** → **kdocs.cn**
3. 复制 `wps_sid` 的值（可选也复制 `csrf`）
4. 粘贴到网页登录框

## 技术栈

- **后端**: Python / Flask / Gunicorn
- **前端**: Tailwind CSS（shadcn/ui 设计风格）
- **部署**: Docker / docker-compose

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/login` | POST | 验证登录 |
| `/api/groups` | GET | 云文档组 |
| `/api/file-tree` | GET | 文件树 |
| `/api/device-list` | GET | 设备列表 |
| `/api/device-files` | GET | 设备文件 |
| `/api/download` | GET | 下载单文件 |
| `/api/batch-download-zip` | POST | 批量 ZIP |
| `/api/batch-progress` | POST | SSE 进度 |

## 注意事项

- Cookie 有效期有限，过期后需要重新获取
- 频繁下载可能触发限流，建议控制批量数量
- 本工具仅供个人数据备份，请遵守 WPS 服务条款

## License

MIT
