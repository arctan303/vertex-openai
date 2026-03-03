# 📸 多模态与图像生成使用指南

该代理不仅支持标准的文本对话，还全面支持 OpenAI 的**多模态视觉输入** (`gpt-4-vision-preview` 格式) 以及**图像生成** (`dall-e` 格式)，所有请求都会被无缝转化为 Vertex AI (Gemini / Imagen 3) 的底层格式。

---

## 👁️ 1. 视觉输入 (Vision / 多模态)

对于支持视觉的 Gemini 模型（如 `gemini-2.5-flash` 或 `gemini-2.0-flash`），你可以像调用 GPT-4V 一样，在 `messages` 数组中混入图片连接或 Base64 编码的图片。

### 示例格式 (cURL)
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <填入你的API_KEY或生成的Token>" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "请描述这张图片里有什么？"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgAB...[省略的海量base64字符串]"
            }
          }
        ]
      }
    ]
  }'
```

---

## 🎨 2. 图像生成 (Text-to-Image)

我们开放了 `/v1/images/generations` 端点，用来替代 OpenAI DALL-E，底层使用 Google 强大的 **Imagen 3** (`imagen-3.0-generate-001`) 模型。

### 核心参数映射说明

| OpenAI (传入) | Vertex Imagen 3 (底层映射) | 备注 |
|---|---|---|
| `model` | `<指定模型>` | 推荐传 `imagen-3.0-generate-001` |
| `prompt` | `instances[0].prompt` | 你的提示词 |
| `n` (张数) | `parameters.sampleCount` | 限制最大为 4 张 |
| `size` (尺寸) | `parameters.aspectRatio` | 仅支持长宽比。`1024x1024`等会被映射为 `"1:1"` |
| `response_format` | 返回格式化方式 | 强烈建议使用 `"b64_json"`，直接返回原始 Base64 图片 |

### 示例请求 (Python OpenAI SDK)

最简单的调用方式是直接使用 OpenAI 官方 Python SDK，把它当做真正的 OpenAI 来用：

```python
from openai import OpenAI
import os
import base64

# 1. 填入你的代理地址和授权 Token
client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="你的API_KEY"
)

# 2. 发起图像生成请求
response = client.images.generate(
    model="imagen-3.0-generate-001",
    prompt="A cute cat wearing sunglasses riding a skateboard in cyberpunk city, 4k resolution, highly detailed",
    n=1,               # 生成 1 张
    size="1024x1024",  # 会被映射到 1:1 比例
    response_format="b64_json" # 以 Base64 的形式直接收图
)

# 3. 解析并保存本地
image_b64 = response.data[0].b64_json
with open("output_cat.png", "wb") as f:
    f.write(base64.b64decode(image_b64))
    
print("✅ 图片已成功保存为 output_cat.png")
```

### 示例请求 (cURL)

```bash
curl http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <填入你的API_KEY>" \
  -d '{
    "model": "imagen-3.0-generate-001",
    "prompt": "An astronaut riding a horse on Mars, photorealistic",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

### 💡 小贴士
由于生成的图片返回的 Base64 字符串非常非常长，在管理后台查看“流量日志”的报错或具体报文时，系统会自动将超长的出入参做 `...[truncated]` 截断保护，防止压垮浏览器。
