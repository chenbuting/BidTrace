# BidTrace · Bruce标迹

投标部局域网台账系统：平台账号、询标报名跟踪、用户权限。

技术栈对齐 BruceAgent 独立站：React + Vite + Tailwind + FastAPI + SQLite。

## 快速开始

### 1. 后端

```bash
cd apps/api
pip install -r requirements.txt
python serve.py
```

默认：`http://0.0.0.0:5200`（局域网可访问）

API 文档：`http://127.0.0.1:5200/docs`

### 2. 前端（开发）

另开一个终端：

```bash
cd apps/web
npm install
npm run dev
```

开发地址：`http://127.0.0.1:5201`（自动代理 `/api` → 5200）

### 3. 生产：构建后由后端托管

```bash
cd apps/web
npm install
npm run build

cd ../api
python serve.py
```

浏览器打开：`http://服务器IP:5200`

## 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | change-me | 管理员 |
| leader | change-me | 投标组长 |
| xunbiao | change-me | 询标员 |
| member | change-me | 专员 |

**首次登录后请立刻改密码。**

## 导入现有 Excel

用 **管理员** 登录后：

1. **平台账号** → 导入 → 选你的平台账号 xlsx（表头需含：平台名称、平台网址…）
2. **询标报名** → 导入 → 选 InquiryStatistics.xlsx（表头需含：报名时间、平台、项目名…）

## 权限说明

- 角色有默认权限包
- 管理员可在「用户权限」里对单人勾选覆盖（加权限或减权限）
- 平台密码默认脱敏；只有管理员（或被授予 `platform.view_password` 的人）能看明文

## 环境变量（可选）

| 变量 | 说明 | 默认 |
|------|------|------|
| BIDTRACE_HOST | 监听地址 | 0.0.0.0 |
| BIDTRACE_PORT | 端口 | 5200 |
| BIDTRACE_SECRET | 会话密钥 | 随机生成 |

## 目录

```
BidTrace/
├── apps/
│   ├── api/          # FastAPI + SQLite
│   └── web/          # React 前端
├── docs/design/      # 设计文档
└── README.md
```
