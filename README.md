# API Center

一个面向 CLI-Proxy / CPA 场景的本地管理面板，提供使用量持久化统计、CodeX 账号管理和模型定价估算。

## 当前能力

- 使用量统计
  - 定时从 CLI-Proxy 导出 usage 数据
  - 持久化到本地 SQLite，重启后历史不丢
  - 按 API、模型、时间维度查看请求量和 Token 消耗
  - 支持 cached tokens / reasoning tokens 展示
- CodeX 账号管理
  - 查看 CodeX 账号列表
  - 批量检查账号有效性
  - 检查 5 小时和周维度配额
  - 批量删除失效账号或低配额账号
- 模型定价
  - 为模型设置输入/输出价格
  - 在前端估算成本

## 当前限制

- 当前版本只支持管理 **一套** CLI-Proxy / CPA 配置
- 目前还 **不支持** 同时保存和切换多套 CPA 地址与密钥
- OpenCode 相关功能已移除

## 为什么有这个项目

[CLI-Proxy-API](https://github.com/router-for-me/CLIProxyAPI) 本身更关注代理转发，不负责长期保存使用记录。  
API Center 通过定时调用 CLI-Proxy 的 usage export 接口，把数据写入本地 SQLite，再提供一个更适合日常查看和清理的 Web 面板。

## 技术栈

- 后端：Node.js + Express + better-sqlite3
- 前端：React + Vite + TailwindCSS + Recharts
- 数据存储：
  - `data/usage.db`：使用量数据库
  - `data/settings.json`：运行配置
  - `data/.session-secret`：本地会话签名密钥

## 快速开始

### 安装依赖

```bash
npm install
```

### 本地运行

如果 CLI-Proxy 就跑在当前机器上，优先用本地运行：

```bash
npm run build
npm start
```

访问：

```text
http://localhost:7940
```

首次进入页面时，填写 CLI-Proxy 管理地址，例如：

```text
http://localhost:8317
```

### 开发模式

```bash
npm run dev
```

- 前端：`http://localhost:5173`
- 后端：`http://localhost:7940`

### 测试

```bash
npm test
```

## 首次使用流程

启动后页面会先要求登录验证。

需要填写：

- CLI-Proxy URL
- CLI-Proxy 管理密码
- 同步间隔

验证通过后，API Center 会：

1. 用你填写的地址和管理密码校验 CLI-Proxy 管理接口是否可用
2. 在浏览器本地保存一个会话 token
3. 在服务端保存当前这套 CLI-Proxy 配置

说明：

- 这不是独立账号系统
- 当前登录本质上是“用 CLI-Proxy 管理密码换取 API Center 的本地会话”
- 所有 `/api/*` 接口都要求这个本地会话，`/api/auth/*` 除外

## Docker 部署

> 如果 CLI-Proxy 与 API Center 在同一台机器上，优先推荐本地运行。Docker 更适合把 API Center 单独封装运行。

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

访问：

```text
http://localhost:7940
```

如果 API Center 在容器里、CLI-Proxy 在宿主机上，页面里通常应填写：

```text
http://host.docker.internal:8317
```

仓库里的 [docker-compose.yml](/root/Code/cli-proxy-API-Center/docker-compose.yml) 已经配置了 `host.docker.internal` 到宿主机网关的映射。

## 持久化说明

部署时建议挂载 `./data:/app/data`，否则删除容器后以下数据都会丢失：

- 历史 usage 数据
- 当前 CLI-Proxy 配置
- 本地会话签名密钥

## systemd 开机自启

仓库内置：

- 启动脚本：`scripts/start-local.sh`
- service 文件：`deploy/systemd/api-center.service`
- 安装脚本：`scripts/install-systemd.sh`

安装方式：

```bash
cd ~/Code/cli-proxy-API-Center
chmod +x scripts/*.sh
sudo ./scripts/install-systemd.sh
```

常用命令：

```bash
systemctl status api-center
systemctl restart api-center
systemctl stop api-center
journalctl -u api-center -f
```
