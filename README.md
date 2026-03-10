# API Center

一站式 cpa痛点 管理工具 — 站点签到、使用量统计、CodeX 账号管理、OpenCode 配置管理。

## 为什么有这个项目？

[CLI-Proxy-API](https://github.com/router-for-me/CLIProxyAPI) 是一个优秀的多模型代理工具，但它不支持使用记录的持久化保存 — 每次重启后历史数据就会丢失。社区曾多次提交 PR 希望加入该功能，均被维护者拒绝（[PR #878](https://github.com/router-for-me/CLIProxyAPI/pull/878)）。

的确，统计数据对 CPA 运行没有任何帮助，但是看着就是很舒服。

API Center 通过定时从 CLI-Proxy 的 export API 同步数据并存入本地 SQLite 数据库，实现了使用记录的持久化，同时提供了更丰富的可视化统计和管理功能。

## 功能

- **使用量统计** — 自动从 CLI-Proxy 同步使用数据，按模型/API/时间维度统计，支持缓存 Tokens 和思考 Tokens 统计
- **站点签到管理** — 管理多个 API 站点的每日签到
- **站点配置管理** — 通过 Web 界面管理 CLI-Proxy 的 OpenAI 兼容提供商配置
- **CodeX 账号管理** — 批量检查账号有效性、查询配额、清理失效账号
- **模型定价** — 自定义模型价格，计算使用成本
- **OpenCode 配置管理** — 可视化管理 `opencode.json` 中的提供商和模型配置（上下文限制、输出限制、输入/输出能力、附件、Variants）
- **Oh My OpenCode 管理** — 可视化管理 `oh-my-opencode.json` 中的 Agents 和 Categories 模型分配

## 技术栈

- **后端**: Node.js + Express + better-sqlite3
- **前端**: React + Vite + TailwindCSS + Recharts
- **数据存储**: SQLite（使用量数据）+ JSON 文件（配置）

## 快速开始

### 安装依赖

```bash
npm install
```

### 本地部署（推荐）

如果你的 CLI-Proxy 就跑在当前机器上，优先使用本地部署，最省事：

```bash
npm run build
npm start
```

访问：

```text
http://localhost:7940
```

页面里将 CLI-Proxy 地址填写为：

```text
http://localhost:8317
```

### 本地部署 + systemd 开机自启（推荐生产用法）

仓库已内置：

- 启动脚本：`scripts/start-local.sh`
- systemd service：`deploy/systemd/api-center.service`
- 安装脚本：`scripts/install-systemd.sh`

安装方式：

```bash
cd ~/Code/cli-proxy-API-Center
chmod +x scripts/*.sh
./scripts/install-systemd.sh
```

常用命令：

```bash
systemctl status api-center
systemctl restart api-center
systemctl stop api-center
journalctl -u api-center -f
```

### 开发模式

```bash
npm run dev
```

前端 Vite 开发服务器运行在 `http://localhost:5173`，后端 API 运行在 `http://localhost:7940`。

### 生产模式

```bash
npm run build
npm start
```

访问 `http://localhost:7940`。

## 首次使用

启动后在页面中配置：

- **CLI-Proxy 地址** — 例如 `http://localhost:8317`
- **管理密码** — CLI-Proxy 的管理密码
- **OpenCode 配置目录**（可选）— 例如 `C:\Users\你的用户名\.config\opencode`，配置后主页会显示 OpenCode 管理入口

配置完成后即可开始使用各项功能。

## Docker 部署

> 如果 CLI-Proxy 与本项目部署在同一台机器上，优先推荐上面的“本地部署（推荐）”。Docker 更适合把 API Center 单独封装运行的场景。

### 直接使用 Docker

```bash
docker build -t cli-proxy-api-center .
docker run -d \
  --name cli-proxy-api-center \
  -p 7940:7940 \
  -e NODE_ENV=production \
  -e PORT=7940 \
  -v $(pwd)/data:/app/data \
  cli-proxy-api-center
```

### 使用 Docker Compose

```bash
docker compose up -d --build
```

启动后访问：

```text
http://localhost:7940
```

### 持久化说明

项目使用 SQLite + JSON 文件保存数据，容器内统一写入 `/app/data`。
因此部署时建议挂载：

- 本地 `./data`
- 容器 `/app/data`

否则删除容器后，历史统计、设置、签到状态等数据会丢失。

### 说明

- Docker 镜像会先执行 `vite build` 构建前端
- 生产环境由 `node server.js` 提供后端接口和 `dist/` 静态页面
- 镜像基于 Debian slim，兼容 `better-sqlite3` 原生模块更稳
