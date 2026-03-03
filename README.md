# Vertex AI → OpenAI API 代理

将 OpenAI 格式的 API 请求转换为 Vertex AI (Gemini) 原生格式，通过 API Key 调用。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 VERTEX_API_KEY

# 3. 启动
npm start
```

## 配置项 (.env)

| 变量 | 必需 | 说明 |
|------|------|------|
| `VERTEX_API_KEY` | ✅ | Vertex AI API Key |
| `PORT` | ❌ | 监听端口，默认 3000 |
| `API_KEY` | ❌ | 保护代理端点的自定义 Key |
| `DEFAULT_MODEL` | ❌ | 默认模型，默认 gemini-2.0-flash |

## 使用示例

### curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### Python (OpenAI SDK)

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="any"
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

## 支持的功能

- ✅ 文本对话（单轮/多轮）
- ✅ 流式响应 (SSE)
- ✅ System message
- ✅ Function calling / Tools
- ✅ 温度、top_p、max_tokens 等参数
- ✅ JSON mode (response_format)
- ✅ 多模态（图片输入）
- ✅ 模型列表 `/v1/models`

## 支持的模型

- gemini-2.5-pro / gemini-2.5-flash
- gemini-2.0-flash / gemini-2.0-flash-lite
- gemini-1.5-pro / gemini-1.5-flash
