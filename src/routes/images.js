/**
 * POST /v1/images/generations - 图像生成路由
 * 接收 OpenAI DALL-E 格式请求 → 转换为 Vertex AI Imagen 格式 → 调用并返回
 */
const express = require("express");
const fetch = require("node-fetch");
const store = require("../store");

const router = express.Router();

const VERTEX_IMAGES_BASE_URL = "https://aiplatform.googleapis.com/v1/publishers/google/models";

// 截断字符串，避免日志过大
function truncate(str, max = 8000) {
    if (!str) return str;
    if (typeof str !== "string") str = JSON.stringify(str);
    return str.length > max ? str.slice(0, max) + "...[truncated]" : str;
}

router.post("/", async (req, res) => {
    const startTime = Date.now();
    let keyInfo = null;
    const requestBody = req.body;

    try {
        const keyResult = store.getNextApiKey();
        if (!keyResult) {
            return res.status(500).json({
                error: { message: "No API keys configured. Add keys in admin panel or set VERTEX_API_KEY in .env", type: "server_error" },
            });
        }
        keyInfo = keyResult;

        const body = req.body;
        // 默认使用 imagen-3.0-generate-001 (或者根据 body.model 映射)
        const logModel = body.model || "imagen-3.0-generate-001";
        const prompt = body.prompt;

        if (!prompt) {
            return res.status(400).json({
                error: { message: "prompt is required", type: "invalid_request_error", param: "prompt", code: null }
            });
        }

        // 解析并限制 n (生成图片数量)，默认为 1，Imagen 3 单次请求最多也是 4 左右，OpenAI 最大 10
        const n = Math.min(Math.max(parseInt(body.n, 10) || 1, 1), 4);

        // n (数量) 不在 parameters 里控制，Imagen3 是由 instances 数组决定生成几张图片？
        // 其实 Imagen 3 支持 sampleCount: n 在 parameters 里。
        const parameters = {
            sampleCount: n,
        };

        // 处理格式 (OpenAI 支持 url / b64_json)
        // Imagen 返回的直接是 base64
        const responseFormat = body.response_format === "url" ? "url" : "b64_json";

        // 处理比例
        // OpenAI: 256x256, 512x512, 1024x1024
        // Imagen 3 支持 aspectRatio: "1:1", "9:16", "16:9", "3:4", "4:3"
        if (body.size) {
            if (body.size === "1024x1024" || body.size === "512x512" || body.size === "256x256") {
                parameters.aspectRatio = "1:1";
            }
        }

        // 构造 Vertex AI Imagen 请求体
        const imagenBody = {
            instances: [
                {
                    prompt: prompt
                }
            ],
            parameters: parameters
        };

        const url = `${VERTEX_IMAGES_BASE_URL}/${logModel}:predict?key=${keyInfo.key}`;

        const upstream = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(imagenBody),
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            let errJson;
            try { errJson = JSON.parse(errText); } catch { errJson = { message: errText }; }

            const maskedUrl = url.replace(/key=[^&]+/, "key=***");
            console.error(`\n[Image Upstream Error] ${upstream.status} ${upstream.statusText}`);
            console.error(`[Image Upstream URL] ${maskedUrl}`);
            console.error(`[Image Upstream Response] ${errText}\n`);

            store.addLog({
                userId: req.user?.id || null,
                userName: req.user?.name || "匿名",
                model: logModel,
                method: "POST",
                protocol: "openai-image",
                keyIndex: keyInfo.keyIndex,
                keyName: keyInfo.keyName,
                promptTokens: 0,
                completionTokens: 0,
                status: upstream.status,
                statusText: "error",
                duration: Date.now() - startTime,
                stream: false,
                requestBody: truncate(requestBody),
                responseBody: truncate(errText),
            });

            return res.status(upstream.status).json({
                error: {
                    message: errJson.error?.message || errJson.message || errText,
                    type: "api_error",
                    code: upstream.status,
                },
            });
        }

        const data = await upstream.json();

        // 构造 OpenAI 格式返回
        const created = Math.floor(Date.now() / 1000);
        const openaiResponse = {
            created: created,
            data: []
        };

        if (data.predictions) {
            for (const pred of data.predictions) {
                // Imagen3 返回 `bytesBase64Encoded`
                const b64 = pred.bytesBase64Encoded;
                if (b64) {
                    if (responseFormat === "b64_json") {
                        openaiResponse.data.push({ b64_json: b64 });
                    } else {
                        // 如果请求了 URL，但我们没有对象存储代理，只能强行返回 base64 的 data URI
                        // 对于标准客户端可能无法完美兼容，但比不返回好
                        const dataUri = `data:${pred.mimeType || "image/png"};base64,${b64}`;
                        openaiResponse.data.push({ url: dataUri });
                    }
                }
            }
        }

        store.addLog({
            userId: req.user?.id || null,
            userName: req.user?.name || "匿名",
            model: logModel,
            method: "POST",
            protocol: "openai-image",
            keyIndex: keyInfo.keyIndex,
            keyName: keyInfo.keyName,
            promptTokens: 0, // 图片生成不用标准 Token 计费
            completionTokens: openaiResponse.data.length, // 用这个代替生成了几张图
            status: 200,
            statusText: "success",
            duration: Date.now() - startTime,
            stream: false,
            requestBody: truncate(requestBody),
            responseBody: truncate(openaiResponse, 2000), // b64 data 太长，截断
        });

        res.json(openaiResponse);

    } catch (err) {
        console.error("Images Generation Error:", err);
        store.addLog({
            userId: req.user?.id || null,
            userName: req.user?.name || "匿名",
            model: "imagen-error",
            method: "POST",
            protocol: "openai-image",
            keyIndex: keyInfo?.keyIndex || -1,
            keyName: keyInfo?.keyName || "unknown",
            promptTokens: 0,
            completionTokens: 0,
            status: 500,
            statusText: "internal_error",
            duration: Date.now() - startTime,
            stream: false,
            requestBody: truncate(requestBody),
            responseBody: truncate(err.stack || err.message),
        });
        res.status(500).json({
            error: { message: "Internal Server Error", type: "server_error" },
        });
    }
});

module.exports = router;
