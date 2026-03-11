# Vertex AI → OpenAI API Proxy

轻量级代理服务器，将 OpenAI 格式的 API 请求转换为 Google Vertex AI (Gemini) 原生格式。支持管理后台、多 Key 负载均衡、流量日志、用户管理。

> **⚠️ 注意事项**  
> 本项目采用极简设计，基于内存和本地文件进行状态存储（定时异步落盘）。**仅支持单机单实例部署**，请勿在 PM2 Cluster 模式或 Kubernetes 多节点容器集中横向扩容（多副本运行），否则会导致 API 限流失效及数据文件读写冲突。

## ✨ 功能特性

- 🔄 **OpenAI 兼容** — 支持 `/v1/chat/completions`, `/v1/images/generations`, `/v1/embeddings` 以及 `/v1/models`
- 🌊 **流式响应** — 完整 SSE 支持
- 🔑 **多 Key 池** — 轮询负载均衡，可单独启用/禁用
- 👥 **用户管理** — 为不同用户生成专属 Token
- 📊 **管理后台** — 流量日志、Token 统计、用户管理、Key 管理
- 🔒 **安全加固** — 120次/分钟限流、暴力破解保护、安全头、基于 Hash 对齐的防时序攻击密钥校验
- 📦 **超轻量** — 仅 4 个依赖，内存占用 < 30MB

## 🚀 部署方式

本项目推荐使用 Docker 部署，保持环境隔离。**本项目无需拉取远程 Docker 镜像**，只需拉取源码，Docker 会在本地自动完成构建并启动。

### 方式一：Docker Compose（推荐）

1. 克隆仓库并进入目录：
```bash
git clone https://github.com/arctan303/vertex-openai.git
cd vertex-openai
```

2. 复制环境变量配置文件并进行修改：
```bash
cp .env.example .env
```
编辑 `.env` 文件，填入你的 `VERTEX_API_KEY`（必需）和 `ADMIN_KEY`（可选，管理后台密码）等配置。

3. 一键构建并启动服务：
```bash
docker compose up -d --build
```

### 方式二：纯 Docker 部署

如果你没有安装 Docker Compose，也可以直接使用 Docker 命令：

```bash
# 1. 本地构建镜像
docker build -t vertex-openai-proxy .

# 2. 运行容器
docker run -d \
  --name vertex-openai \
  -p 3000:3000 \
  -v vertex-proxy-data:/app/data \
  -e VERTEX_API_KEY=your-api-key \
  -e ADMIN_KEY=your-admin-password \
  --restart unless-stopped \
  vertex-openai-proxy
```

### 方式三：Node.js 直接运行

1. 安装依赖：
```bash
npm install
```
2. 配置环境变量：
```bash
cp .env.example .env 
```
3. 启动服务：
```bash
npm start
```

## ⚙️ 配置项 (.env)

| 变量 | 必需 | 说明 |
|------|------|------|
| `VERTEX_API_KEY` | ✅ | Vertex AI API Key（也可在后台动态添加多个做负载均衡） |
| `PORT` | ❌ | 监听端口，默认 `3000` |
| `ADMIN_KEY` | ❌ | 管理后台密码，留空则无需登录 |
| `API_KEY` | ❌ | 全局 API Key，保护代理端点 |
| `DEFAULT_MODEL` | ❌ | 默认模型，默认 `gemini-2.0-flash` |

## 📖 使用示例

启动后，可以像使用 OpenAI API 一样直接调用本服务。

### cURL 调用

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### Python (OpenAI SDK)

你可以直接通过官方的 OpenAI 客户端库，通过修改 `base_url` 接入：

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="<your-token>"  
)

response = client.chat.completions.create(
    model="gemini-2.0-flash",
    messages=[{"role": "user", "content": "你好"}],
)
print(response.choices[0].message.content)
```

### 流式请求

```python
stream = client.chat.completions.create(
    model="gemini-2.0-flash",
    messages=[{"role": "user", "content": "讲个故事"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## 🖥️ 管理后台

浏览器访问 `http://localhost:3000/admin` 即可进入管理后台。

| 功能模块 | 说明 |
|------|------|
| 📋 流量日志 | 查看所有请求记录，双击可查看完整的请求/响应报文详情 |
| 📊 Token 统计 | 按用户、模型、日期多维度统计 Token 消耗情况 |
| 👥 用户管理 | 创建/删除用户，动态分配并吊销专属的调用 Token |
| 🔑 API Key 管理 | 添加多个 Vertex AI Key，系统会自动切分负载。对达到超限报错的 Key 将自动隔离处理 |

## 🔒 安全特性

- **IP 限流** — 默认 120 次/分钟，超限返回 HTTP 429
- **暴力破解保护** — 登录连续 5 次失败后将锁定 5 分钟
- **安全响应头** — 强制 `X-Frame-Options`、`X-Content-Type-Options` 等常见防范机制
- **时序安全比对** — 密码和 Token 匹配使用 SHA-256 Hash 对齐和原生 `timingSafeEqual` 防御时序攻击
- **敏感信息脱敏** — 后台界面中显示的 API Key 均采用掩码部分隐藏截断

## 🤖 支持的模型

### 💬 对话语言模型 (Chat Completions)
- **Gemini 3 系列**：`gemini-3.0-pro` / `gemini-3.0-flash`
- **Gemini 2 系列**：`gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-2.0-flash` / `gemini-2.0-flash-lite`
- **Gemini 1.5 系列**：`gemini-1.5-pro` / `gemini-1.5-flash`

### 🎨 图像生成模型 (Image Generation)
- `imagen-3.0-generate-001`

### 🧬 向量嵌入模型 (Embeddings)
- `text-embedding-005` / `text-embedding-004`
- `text-multilingual-embedding-002`
- `multimodalembedding@001`
- `gemini-embedding-001`

## 📁 项目目录结构

```
vertex-openai/
├── src/
│   ├── index.js          # 主入口文件：Express Web 框架封装、安全中间件
│   ├── store.js          # 数据存储层：内存缓存 + 异步后台落盘机制
│   ├── converter.js      # 核心转换协议器：OpenAI ↔ Gemini JSON 结构体映射
│   ├── admin.html        # 单页面管理控制台前端 UI
│   └── routes/
│       ├── chat.js       # 处理 /v1/chat/completions OpenAI 接口
│       ├── models.js     # 处理 /v1/models 接口
│       └── admin.js      # 处理 /admin/* 管理控制台 API
├── data/                 # 运行时动态生成的用户、配置、缓存文件（由程序自动建立，不会被 git 追踪）
├── docker-compose.yml    # 用于 Docker 容器一键组网编排配置
├── Dockerfile            # 容器环境构建规则
├── .env.example          # 环境参数占位样本
└── package.json          # Node 模块依赖管理
```

## 📜 License

MIT License
