/**
 * Vertex AI → OpenAI API 格式转换代理服务器
 * 入口文件
 *
 * 安全: 安全头 / IP限流 / CORS限制
 * 性能: Gzip压缩
 */
require("dotenv").config();

const express = require("express");
const compression = require("compression");
const store = require("./store");
const chatRoutes = require("./routes/chat");
const modelsRoutes = require("./routes/models");
const adminRoutes = require("./routes/admin");

const app = express();

// ============================================================
// 安全: HTTP 安全头
// ============================================================
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
});

// ============================================================
// 性能: Gzip 压缩
// ============================================================
app.use(compression({
    threshold: 1024, // 仅压缩 > 1KB 的响应
    filter: (req, res) => {
        // SSE 流不压缩
        if (req.path.includes("chat/completions") && req.body?.stream) return false;
        return compression.filter(req, res);
    },
}));

// JSON 解析 (限制请求体大小)
app.use(express.json({ limit: "5mb" }));

// ============================================================
// 安全: CORS（/v1/* 允许跨域，/admin/* 仅同源）
// ============================================================
app.use((req, res, next) => {
    if (req.path.startsWith("/admin")) {
        // Admin 仅同源访问
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

// ============================================================
// 安全: 简易 IP 限流器（内存实现，无额外依赖）
// ============================================================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 分钟窗口
const RATE_LIMIT_MAX = 120;           // 每分钟最多 120 次请求

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    let entry = rateLimitMap.get(ip);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
        entry = { windowStart: now, count: 0 };
        rateLimitMap.set(ip, entry);
    }

    entry.count++;

    if (entry.count > RATE_LIMIT_MAX) {
        res.setHeader("Retry-After", Math.ceil((RATE_LIMIT_WINDOW - (now - entry.windowStart)) / 1000));
        return res.status(429).json({
            error: { message: "Too many requests. Please slow down.", type: "rate_limit_error" },
        });
    }

    // 响应头显示限流信息
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, RATE_LIMIT_MAX - entry.count));
    next();
}

// 定期清理过期条目（每 5 分钟）
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) {
            rateLimitMap.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// /v1/* 走限流（admin 不限流）
app.use("/v1", rateLimit);

// ============================================================
// API 鉴权中间件（仅 /v1/* 路径）
// ============================================================
app.use("/v1", (req, res, next) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    // 1. 全局 key
    const globalKey = process.env.API_KEY;
    if (globalKey && token && store.timingSafeCompare(token, globalKey)) {
        req.user = { id: "global", name: "全局 Key" };
        return next();
    }

    // 2. 用户 token
    if (token) {
        const user = store.getUserByToken(token);
        if (user) {
            req.user = { id: user.id, name: user.name };
            return next();
        }
    }

    // 3. 无密钥配置 → 匿名
    const users = store.getUsers();
    if (!globalKey && users.length === 0) {
        req.user = null;
        return next();
    }

    // 4. 拒绝
    if (!token) {
        return res.status(401).json({
            error: { message: "Missing API key. Provide via Authorization: Bearer <token>", type: "auth_error" },
        });
    }
    return res.status(401).json({
        error: { message: "Invalid API key", type: "auth_error" },
    });
});

// 路由
app.use("/v1/chat/completions", chatRoutes);
app.use("/v1/models", modelsRoutes);
app.use("/admin", adminRoutes);

// 健康检查
app.get("/", (req, res) => {
    res.json({ status: "ok", service: "vertex-openai-proxy", uptime: process.uptime() });
});

// 全局错误处理
app.use((err, req, res, _next) => {
    console.error("[unhandled error]", err);
    if (!res.headersSent) {
        res.status(500).json({ error: { message: "Internal server error", type: "server_error" } });
    }
});

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Vertex-OpenAI proxy running on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`   POST /v1/chat/completions`);
    console.log(`   GET  /v1/models`);
    console.log(`   GET  /admin`);
    console.log(`   Security: rate-limit=${RATE_LIMIT_MAX}/min, gzip=on, security-headers=on`);
});
