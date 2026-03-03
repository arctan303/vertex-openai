/**
 * POST /v1/chat/completions - 核心路由
 * 接收 OpenAI 格式请求 → 转换为 Gemini 格式 → 调用 Vertex AI → 转换响应返回
 */
const express = require("express");
const fetch = require("node-fetch");
const store = require("../store");
const {
    openaiToGemini,
    geminiToOpenai,
    geminiStreamChunkToOpenai,
} = require("../converter");

const router = express.Router();

const VERTEX_BASE_URL = "https://aiplatform.googleapis.com/v1/publishers/google/models";

// 截断字符串，避免日志过大
function truncate(str, max = 8000) {
    if (!str) return str;
    if (typeof str !== "string") str = JSON.stringify(str);
    return str.length > max ? str.slice(0, max) + "...[truncated]" : str;
}

router.post("/", async (req, res) => {
    const startTime = Date.now();
    let logModel = "";
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
        logModel = (body.model || process.env.DEFAULT_MODEL || "gemini-2.0-flash")
            .replace(/^google\//, "");
        const isStream = body.stream === true;

        // 转换请求格式
        const geminiBody = openaiToGemini(body);

        // 构建 Vertex AI URL
        const action = isStream ? "streamGenerateContent" : "generateContent";
        const url = `${VERTEX_BASE_URL}/${logModel}:${action}?key=${keyInfo.key}${isStream ? "&alt=sse" : ""}`;

        // 发起请求
        const upstream = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiBody),
        });

        // 错误处理
        if (!upstream.ok) {
            const errText = await upstream.text();
            let errJson;
            try { errJson = JSON.parse(errText); } catch { errJson = { message: errText }; }

            store.addLog({
                userId: req.user?.id || null,
                userName: req.user?.name || "匿名",
                model: logModel,
                method: "POST",
                protocol: "openai",
                keyIndex: keyInfo.keyIndex,
                keyName: keyInfo.keyName,
                promptTokens: 0,
                completionTokens: 0,
                status: upstream.status,
                statusText: "error",
                duration: Date.now() - startTime,
                stream: isStream,
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

        // ---- 非流式响应 ----
        if (!isStream) {
            const geminiData = await upstream.json();
            const openaiResponse = geminiToOpenai(geminiData, logModel);

            store.addLog({
                userId: req.user?.id || null,
                userName: req.user?.name || "匿名",
                model: logModel,
                method: "POST",
                protocol: "openai",
                keyIndex: keyInfo.keyIndex,
                keyName: keyInfo.keyName,
                promptTokens: openaiResponse.usage?.prompt_tokens || 0,
                completionTokens: openaiResponse.usage?.completion_tokens || 0,
                status: 200,
                statusText: "success",
                duration: Date.now() - startTime,
                stream: false,
                requestBody: truncate(requestBody),
                responseBody: truncate(openaiResponse),
            });

            return res.json(openaiResponse);
        }

        // ---- 流式响应 (SSE) ----
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        let chunkIndex = 0;
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let streamedContent = "";

        const reader = upstream.body;
        let buffer = "";

        reader.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr || jsonStr === "[DONE]") continue;

                    try {
                        const geminiChunk = JSON.parse(jsonStr);
                        const openaiChunk = geminiStreamChunkToOpenai(geminiChunk, logModel, chunkIndex);
                        res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                        chunkIndex++;

                        // 累计
                        if (openaiChunk.choices?.[0]?.delta?.content) {
                            streamedContent += openaiChunk.choices[0].delta.content;
                        }
                        if (geminiChunk.usageMetadata) {
                            totalPromptTokens = geminiChunk.usageMetadata.promptTokenCount || totalPromptTokens;
                            totalCompletionTokens = geminiChunk.usageMetadata.candidatesTokenCount || totalCompletionTokens;
                        }
                    } catch (e) {
                        console.error("[stream parse error]", e.message);
                    }
                }
            }
        });

        reader.on("end", () => {
            if (buffer.startsWith("data: ")) {
                const jsonStr = buffer.slice(6).trim();
                if (jsonStr && jsonStr !== "[DONE]") {
                    try {
                        const geminiChunk = JSON.parse(jsonStr);
                        const openaiChunk = geminiStreamChunkToOpenai(geminiChunk, logModel, chunkIndex);
                        res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                        if (openaiChunk.choices?.[0]?.delta?.content) {
                            streamedContent += openaiChunk.choices[0].delta.content;
                        }
                        if (geminiChunk.usageMetadata) {
                            totalPromptTokens = geminiChunk.usageMetadata.promptTokenCount || totalPromptTokens;
                            totalCompletionTokens = geminiChunk.usageMetadata.candidatesTokenCount || totalCompletionTokens;
                        }
                    } catch { }
                }
            }
            res.write("data: [DONE]\n\n");
            res.end();

            store.addLog({
                userId: req.user?.id || null,
                userName: req.user?.name || "匿名",
                model: logModel,
                method: "POST",
                protocol: "openai",
                keyIndex: keyInfo.keyIndex,
                keyName: keyInfo.keyName,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                status: 200,
                statusText: "success",
                duration: Date.now() - startTime,
                stream: true,
                requestBody: truncate(requestBody),
                responseBody: truncate({ role: "assistant", content: streamedContent }),
            });
        });

        reader.on("error", (err) => {
            console.error("[stream error]", err.message);
            res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();

            store.addLog({
                userId: req.user?.id || null,
                userName: req.user?.name || "匿名",
                model: logModel,
                method: "POST",
                protocol: "openai",
                keyIndex: keyInfo.keyIndex,
                keyName: keyInfo.keyName,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                status: 500,
                statusText: "error",
                duration: Date.now() - startTime,
                stream: true,
                requestBody: truncate(requestBody),
                responseBody: truncate(err.message),
            });
        });

        req.on("close", () => {
            reader.destroy();
        });

    } catch (err) {
        console.error("[chat error]", err);

        store.addLog({
            userId: req.user?.id || null,
            userName: req.user?.name || "匿名",
            model: logModel,
            method: "POST",
            protocol: "openai",
            keyIndex: keyInfo?.keyIndex || 0,
            keyName: keyInfo?.keyName || "N/A",
            promptTokens: 0,
            completionTokens: 0,
            status: 500,
            statusText: "error",
            duration: Date.now() - startTime,
            stream: false,
            requestBody: truncate(requestBody),
            responseBody: truncate(err.message),
        });

        if (!res.headersSent) {
            res.status(500).json({
                error: { message: err.message, type: "server_error" },
            });
        }
    }
});

module.exports = router;
