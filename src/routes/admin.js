/**
 * /admin/* - 管理后台 API 和页面路由
 *
 * 安全: 暴力破解保护 / 时序安全比较 / API Key 脱敏
 */
const express = require("express");
const path = require("path");
const store = require("../store");

const router = express.Router();

// ============================================================
// 登录暴力破解保护
// ============================================================
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 分钟锁定

function checkLoginLock(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.lockedAt < LOCKOUT_DURATION && entry.count >= MAX_LOGIN_ATTEMPTS) {
        return true; // 仍在锁定中
    }
    if (Date.now() - entry.lockedAt >= LOCKOUT_DURATION) {
        loginAttempts.delete(ip); // 锁定过期
    }
    return false;
}

function recordLoginFailure(ip) {
    const entry = loginAttempts.get(ip) || { count: 0, lockedAt: Date.now() };
    entry.count++;
    entry.lockedAt = Date.now();
    loginAttempts.set(ip, entry);
}

function clearLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

// 定期清理过期记录
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of loginAttempts) {
        if (now - entry.lockedAt > LOCKOUT_DURATION * 2) loginAttempts.delete(ip);
    }
}, 10 * 60 * 1000);

// ============================================================
// Admin 鉴权中间件
// ============================================================
function adminAuth(req, res, next) {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) return next();

    // API 通过 header 验证
    const xKey = req.headers["x-admin-key"];
    if (xKey && store.timingSafeCompare(xKey, adminKey)) return next();

    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token && store.timingSafeCompare(token, adminKey)) return next();

    return res.status(401).json({ error: "Unauthorized" });
}

// ============================================================
// 登录 API（不需要鉴权，但有暴力保护）
// ============================================================
router.post("/api/login", (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";

    // 检查是否被锁定
    if (checkLoginLock(ip)) {
        const entry = loginAttempts.get(ip);
        const remaining = Math.ceil((LOCKOUT_DURATION - (Date.now() - entry.lockedAt)) / 1000);
        return res.status(429).json({
            success: false,
            error: `登录失败次数过多，请 ${remaining} 秒后重试`,
        });
    }

    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) {
        return res.json({ success: true, token: "" });
    }

    const { password } = req.body;
    if (password && store.timingSafeCompare(password, adminKey)) {
        clearLoginAttempts(ip);
        return res.json({ success: true, token: adminKey });
    }

    recordLoginFailure(ip);
    const entry = loginAttempts.get(ip);
    const attemptsLeft = MAX_LOGIN_ATTEMPTS - entry.count;

    return res.status(401).json({
        success: false,
        error: attemptsLeft > 0 ? `密码错误，还可尝试 ${attemptsLeft} 次` : "登录失败次数过多，已锁定 5 分钟",
    });
});

// ============================================================
// 后台页面（前端处理登录）
// ============================================================
router.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "admin.html"));
});

// ============================================================
// 管理 API（需要鉴权）
// ============================================================
router.use("/api", adminAuth);

// 调用记录（分页）
router.get("/api/logs", (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));
    res.json(store.getLogs(page, pageSize));
});

// 单条日志详情（直接 O(n) 查找，不读全量）
router.get("/api/logs/:id", (req, res) => {
    const id = req.params.id;
    // 基本输入校验
    if (!/^l_[a-f0-9]{12}$/.test(id)) {
        return res.status(400).json({ error: "Invalid log ID" });
    }
    const log = store.getLogById(id);
    if (!log) return res.status(404).json({ error: "Not found" });
    res.json(log);
});

// 统计
router.get("/api/stats", (req, res) => {
    res.json(store.getStats());
});

// 用户列表
router.get("/api/users", (req, res) => {
    res.json(store.getUsers());
});

// 创建用户（输入校验）
router.post("/api/users", (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "用户名不能为空" });
    }
    const sanitized = name.trim().slice(0, 50); // 最长 50 字符
    if (!sanitized) return res.status(400).json({ error: "用户名不能为空" });
    const user = store.createUser(sanitized);
    res.json(user);
});

// 删除用户
router.delete("/api/users/:id", (req, res) => {
    const ok = store.deleteUser(req.params.id);
    res.json({ success: ok });
});

// 启用/禁用用户
router.patch("/api/users/:id", (req, res) => {
    const { enabled } = req.body;
    const ok = store.toggleUser(req.params.id, enabled === true);
    res.json({ success: ok });
});

// ============================================================
// API Key 池管理
// ============================================================
router.get("/api/apikeys", (req, res) => {
    const keys = store.getApiKeys().map((k) => ({
        ...k,
        key: k.key.slice(0, 8) + "..." + k.key.slice(-4), // 脱敏
    }));
    res.json(keys);
});

router.post("/api/apikeys", (req, res) => {
    const { key, name } = req.body;
    if (!key || typeof key !== "string" || !key.trim()) {
        return res.status(400).json({ error: "API Key 不能为空" });
    }
    const entry = store.addApiKey(key.trim(), name?.trim()?.slice(0, 50));
    if (!entry) {
        return res.status(400).json({ error: "该 API Key 已存在" });
    }
    // 返回脱敏版本
    res.json({ ...entry, key: entry.key.slice(0, 8) + "..." + entry.key.slice(-4) });
});

router.delete("/api/apikeys/:id", (req, res) => {
    const ok = store.deleteApiKey(req.params.id);
    res.json({ success: ok });
});

router.patch("/api/apikeys/:id", (req, res) => {
    const { enabled } = req.body;
    const ok = store.toggleApiKey(req.params.id, enabled === true);
    res.json({ success: ok });
});

module.exports = router;
