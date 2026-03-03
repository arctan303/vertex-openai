# Vertex AI → OpenAI API 代理

轻量级代理服务器，将 OpenAI 格式的 API 请求转换为 Google Vertex AI (Gemini) 原生格式。支持管理后台、多 Key 负载均衡、流量日志、用户管理。

## ✨ 功能特性

- 🔄 **OpenAI 兼容** — 支持 `/v1/chat/completions`, `/v1/images/generations`, `/v1/embeddings` 以及 `/v1/models`
- 🌊 **流式响应** — 完整 SSE 支持
- 🔑 **多 Key 池** — 轮询负载均衡，可单独启用/禁用
- 👥 **用户管理** — 为不同用户生成专属 Token
- 📊 **管理后台** — 流量日志、Token 统计、用户管理、Key 管理
- 🔒 **安全加固** — 限流、暴力破解保护、安全头、密码登录
- 📦 **超轻量** — 仅 4 个依赖，内存占用 < 30MB

## 🚀 部署方式

### 方式一：直接运行

```bash
# 1. 克隆仓库
git clone <your-repo-url>
cd vertex-openai

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的配置

# 4. 启动
npm start
```

### 方式二：Docker 部署（推荐）

```bash
# 构建镜像
docker build -t vertex-openai .

# 运行
docker run -d \
  --name vertex-openai \
  -p 3000:3000 \
  -v vertex-data:/app/data \
  -e VERTEX_API_KEY=your-api-key \
  -e ADMIN_KEY=your-admin-password \
  --restart unless-stopped \
  vertex-openai
```

### 方式三：Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'
services:
  proxy:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - proxy-data:/app/data
    environment:
      - VERTEX_API_KEY=your-api-key
      - ADMIN_KEY=your-admin-password
      - PORT=3000
    restart: unless-stopped

volumes:
  proxy-data:
```

```bash
docker compose up -d
```

## ⚙️ 配置项 (.env)

| 变量 | 必需 | 说明 |
|------|------|------|
| `VERTEX_API_KEY` | ✅ | Vertex AI API Key（也可在后台添加多个） |
| `PORT` | ❌ | 监听端口，默认 `3000` |
| `ADMIN_KEY` | ❌ | 管理后台密码，留空则无需登录 |
| `API_KEY` | ❌ | 全局 API Key，保护代理端点 |
| `DEFAULT_MODEL` | ❌ | 默认模型，默认 `gemini-2.0-flash` |

## 📖 使用示例

### curl

```bash
curl http://your-server:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### Python (OpenAI SDK)

```python
import openai

client = openai.OpenAI(
    base_url="http://your-server:3000/v1",
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

访问 `http://your-server:3000/admin`

| 功能 | 说明 |
|------|------|
| 📋 流量日志 | 查看所有请求记录，双击查看请求/响应报文详情 |
| 📊 Token 统计 | 按用户、模型、日期统计 Token 消耗 |
| 👥 用户管理 | 创建/删除用户，每个用户有专属 Token |
| 🔑 API Key 管理 | 添加多个 Vertex AI Key，轮询负载均衡 |

## 🔒 安全特性

- **IP 限流** — 120 次/分钟，超限返回 429
- **暴力破解保护** — 登录连续 5 次失败锁定 5 分钟
- **安全头** — X-Frame-Options、X-Content-Type-Options 等
- **时序安全比较** — 密码和 Token 使用 `timingSafeEqual`
- **API Key 脱敏** — 后台仅显示部分字符

## 🤖 支持的模型

### 💬 对话模型 (Chat Completions)
- **Gemini 3 系列**：gemini-3.0-pro / gemini-3.0-flash
- **Gemini 2 系列**：gemini-2.5-pro / gemini-2.5-flash / gemini-2.0-flash / gemini-2.0-flash-lite
- **Gemini 1.5 系列**：gemini-1.5-pro / gemini-1.5-flash

### 🎨 图像生成模型 (Image Generation)
- imagen-3.0-generate-001

### 🧬 向量嵌入模型 (Embeddings)
- text-embedding-005 / text-embedding-004
- text-multilingual-embedding-002
- multimodalembedding@001
- gemini-embedding-001

## 📁 项目结构

```
vertex-openai/
├── src/
│   ├── index.js          # 入口：Express 服务器 + 中间件
│   ├── store.js          # 数据层：内存缓存 + 异步落盘
│   ├── converter.js      # 格式转换：OpenAI ↔ Gemini
│   ├── admin.html        # 管理后台 UI
│   └── routes/
│       ├── chat.js       # /v1/chat/completions 路由
│       ├── models.js     # /v1/models 路由
│       └── admin.js      # /admin/* 管理 API
├── data/                 # 运行时数据（自动创建，勿提交）
├── Dockerfile
├── .env.example
└── package.json
```

## License

MIT
