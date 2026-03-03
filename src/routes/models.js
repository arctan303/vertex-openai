/**
 * GET /v1/models - 返回可用的 Gemini 模型列表
 */
const express = require("express");
const router = express.Router();

const MODELS = [
    { id: "gemini-3.0-pro", name: "Gemini 3.0 Pro" },
    { id: "gemini-3.0-flash", name: "Gemini 3.0 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash-Lite" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
    { id: "text-embedding-005", name: "Text Embedding 005" },
    { id: "text-embedding-004", name: "Text Embedding 004" },
    { id: "text-multilingual-embedding-002", name: "Text Multilingual Embedding 002" },
    { id: "multimodalembedding@001", name: "Multimodal Embedding 001" },
    { id: "gemini-embedding-001", name: "Gemini Embedding 001" },
    { id: "imagen-3.0-generate-001", name: "Imagen 3.0 Generate" }
];

router.get("/", (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    res.json({
        object: "list",
        data: MODELS.map((m) => ({
            id: m.id,
            object: "model",
            created: now,
            owned_by: "google",
        })),
    });
});

module.exports = router;
