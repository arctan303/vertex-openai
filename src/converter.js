/**
 * OpenAI ↔ Gemini 格式转换核心模块
 */

// ============================================================
// 请求转换: OpenAI → Gemini
// ============================================================

/**
 * 将 OpenAI Chat Completion 请求体转换为 Gemini generateContent 请求体
 */
function openaiToGemini(body) {
  const result = {};
  const messages = body.messages || [];

  // 1. 提取 system message → systemInstruction
  const systemMessages = messages.filter((m) => m.role === "system");
  if (systemMessages.length > 0) {
    result.systemInstruction = {
      parts: systemMessages.map((m) => ({ text: getTextContent(m.content) })),
    };
  }

  // 2. 转换 user/assistant/tool messages → contents
  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  result.contents = nonSystemMessages.map((m) => convertMessage(m));

  // 3. generationConfig
  const genConfig = {};
  if (body.temperature !== undefined) genConfig.temperature = body.temperature;
  if (body.top_p !== undefined) genConfig.topP = body.top_p;
  if (body.max_tokens !== undefined) genConfig.maxOutputTokens = body.max_tokens;
  if (body.max_completion_tokens !== undefined) genConfig.maxOutputTokens = body.max_completion_tokens;
  if (body.stop) genConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (body.frequency_penalty !== undefined) genConfig.frequencyPenalty = body.frequency_penalty;
  if (body.presence_penalty !== undefined) genConfig.presencePenalty = body.presence_penalty;
  if (body.seed !== undefined) genConfig.seed = body.seed;
  if (body.n !== undefined) genConfig.candidateCount = body.n;

  // response_format
  if (body.response_format) {
    if (body.response_format.type === "json_object") {
      genConfig.responseMimeType = "application/json";
    } else if (body.response_format.type === "json_schema") {
      genConfig.responseMimeType = "application/json";
      if (body.response_format.json_schema?.schema) {
        genConfig.responseSchema = body.response_format.json_schema.schema;
      }
    } else if (body.response_format.type === "text") {
      genConfig.responseMimeType = "text/plain";
    }
  }

  if (Object.keys(genConfig).length > 0) {
    result.generationConfig = genConfig;
  }

  // 4. tools → functionDeclarations
  if (body.tools && body.tools.length > 0) {
    const functionDeclarations = body.tools
      .filter((t) => t.type === "function")
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || "",
        parameters: t.function.parameters || {},
      }));
    if (functionDeclarations.length > 0) {
      result.tools = [{ functionDeclarations }];
    }
  }

  // 5. tool_choice
  if (body.tool_choice) {
    const toolConfig = {};
    if (body.tool_choice === "none") {
      toolConfig.functionCallingConfig = { mode: "NONE" };
    } else if (body.tool_choice === "auto") {
      toolConfig.functionCallingConfig = { mode: "AUTO" };
    } else if (body.tool_choice === "required") {
      toolConfig.functionCallingConfig = { mode: "ANY" };
    } else if (typeof body.tool_choice === "object" && body.tool_choice.function) {
      toolConfig.functionCallingConfig = {
        mode: "ANY",
        allowedFunctionNames: [body.tool_choice.function.name],
      };
    }
    if (Object.keys(toolConfig).length > 0) {
      result.toolConfig = toolConfig;
    }
  }

  return result;
}

/**
 * 转换单条消息
 */
function convertMessage(msg) {
  const role = msg.role === "assistant" ? "model" : "user";

  // tool 消息 → functionResponse
  if (msg.role === "tool") {
    let responseData;
    try {
      responseData = JSON.parse(msg.content);
    } catch {
      responseData = { result: msg.content };
    }
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: msg.tool_call_id || "unknown",
            response: responseData,
          },
        },
      ],
    };
  }

  // assistant 带 tool_calls
  if (msg.role === "assistant" && msg.tool_calls) {
    const parts = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    for (const tc of msg.tool_calls) {
      let args;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      parts.push({
        functionCall: {
          name: tc.function.name,
          args,
        },
      });
    }
    return { role: "model", parts };
  }

  // 普通文本 / 多模态内容
  if (typeof msg.content === "string") {
    return { role, parts: [{ text: msg.content }] };
  }

  // 多模态内容数组 (OpenAI vision format)
  if (Array.isArray(msg.content)) {
    const parts = msg.content.map((item) => {
      if (item.type === "text") {
        return { text: item.text };
      }
      if (item.type === "image_url") {
        const url = typeof item.image_url === "string" ? item.image_url : item.image_url?.url;
        if (url && url.startsWith("data:")) {
          // base64 内嵌图片: data:image/png;base64,xxx
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return { inlineData: { mimeType: match[1], data: match[2] } };
          }
        }
        // URL 图片
        return { fileData: { mimeType: "image/jpeg", fileUri: url } };
      }
      return { text: JSON.stringify(item) };
    });
    return { role, parts };
  }

  return { role, parts: [{ text: String(msg.content || "") }] };
}

/**
 * 从 content 中提取纯文本
 */
function getTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return String(content || "");
}

// ============================================================
// 响应转换: Gemini → OpenAI
// ============================================================

/**
 * 将 Gemini generateContent 响应转换为 OpenAI Chat Completion 响应
 */
function geminiToOpenai(geminiResponse, model) {
  const id = "chatcmpl-" + generateId();
  const created = Math.floor(Date.now() / 1000);

  const choices = (geminiResponse.candidates || []).map((candidate, index) => {
    const choice = {
      index,
      message: { role: "assistant", content: null },
      finish_reason: mapFinishReason(candidate.finishReason),
    };

    if (candidate.content && candidate.content.parts) {
      const textParts = [];
      const toolCalls = [];

      for (const part of candidate.content.parts) {
        if (part.text !== undefined) {
          textParts.push(part.text);
        }
        if (part.functionCall) {
          toolCalls.push({
            id: "call_" + generateId(),
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          });
        }
      }

      if (textParts.length > 0) {
        choice.message.content = textParts.join("");
      }
      if (toolCalls.length > 0) {
        choice.message.tool_calls = toolCalls;
      }
    }

    return choice;
  });

  // 如果没有 choices，返回一个空的
  if (choices.length === 0) {
    choices.push({
      index: 0,
      message: { role: "assistant", content: "" },
      finish_reason: "stop",
    });
  }

  const result = {
    id,
    object: "chat.completion",
    created,
    model,
    choices,
    usage: {
      prompt_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0,
    },
  };

  return result;
}

/**
 * 将 Gemini 流式块转换为 OpenAI SSE chunk 格式
 */
function geminiStreamChunkToOpenai(geminiChunk, model, chunkIndex) {
  const id = "chatcmpl-" + generateId();
  const created = Math.floor(Date.now() / 1000);

  const choices = (geminiChunk.candidates || []).map((candidate, index) => {
    const delta = {};

    if (chunkIndex === 0) {
      delta.role = "assistant";
    }

    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.text !== undefined) {
          delta.content = (delta.content || "") + part.text;
        }
        if (part.functionCall) {
          if (!delta.tool_calls) delta.tool_calls = [];
          delta.tool_calls.push({
            index: delta.tool_calls.length,
            id: "call_" + generateId(),
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          });
        }
      }
    }

    return {
      index,
      delta,
      finish_reason: candidate.finishReason ? mapFinishReason(candidate.finishReason) : null,
    };
  });

  if (choices.length === 0) {
    choices.push({ index: 0, delta: {}, finish_reason: null });
  }

  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices,
    usage: geminiChunk.usageMetadata
      ? {
          prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
          completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
          total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
        }
      : undefined,
  };
}

// ============================================================
// 工具函数
// ============================================================

function mapFinishReason(reason) {
  if (!reason) return "stop";
  const map = {
    STOP: "stop",
    FINISH_REASON_STOP: "stop",
    MAX_TOKENS: "length",
    FINISH_REASON_MAX_TOKENS: "length",
    SAFETY: "content_filter",
    FINISH_REASON_SAFETY: "content_filter",
    RECITATION: "content_filter",
    FINISH_REASON_RECITATION: "content_filter",
    OTHER: "stop",
    FINISH_REASON_OTHER: "stop",
  };
  return map[reason] || "stop";
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

module.exports = {
  openaiToGemini,
  geminiToOpenai,
  geminiStreamChunkToOpenai,
};
