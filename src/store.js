/**
 * 轻量 JSON 文件数据存储（内存缓存 + 异步批量写入）
 *
 * 性能优化:
 *   - 启动时加载 JSON 到内存，所有读操作零磁盘 I/O
 *   - 写操作标记 dirty，每 5 秒异步批量落盘
 *   - 日志追加直接在内存中 push
 *
 * 安全优化:
 *   - 使用 crypto.timingSafeEqual 比较密钥
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LOGS_FILE = path.join(DATA_DIR, "logs.json");
const APIKEYS_FILE = path.join(DATA_DIR, "apikeys.json");

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================
// 内存缓存层
// ============================================================

const _cache = {};
const _dirty = new Set();

function loadFromDisk(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
        return [];
    }
}

function getCached(file) {
    if (!(file in _cache)) {
        _cache[file] = loadFromDisk(file);
    }
    return _cache[file];
}

function setCached(file, data) {
    _cache[file] = data;
    _dirty.add(file);
}

// 异步批量落盘（每 5 秒）
function flushDirty() {
    for (const file of _dirty) {
        const data = _cache[file];
        if (data !== undefined) {
            fs.writeFile(file, JSON.stringify(data), "utf-8", (err) => {
                if (err) console.error(`[store] flush error for ${path.basename(file)}:`, err.message);
            });
        }
    }
    _dirty.clear();
}

const FLUSH_INTERVAL = 5000;
setInterval(flushDirty, FLUSH_INTERVAL);

// 进程退出前同步落盘，防止数据丢失
function flushSync() {
    for (const file of _dirty) {
        const data = _cache[file];
        if (data !== undefined) {
            try { fs.writeFileSync(file, JSON.stringify(data), "utf-8"); } catch { }
        }
    }
    _dirty.clear();
}
process.on("exit", flushSync);
process.on("SIGINT", () => { flushSync(); process.exit(0); });
process.on("SIGTERM", () => { flushSync(); process.exit(0); });

// 预热缓存
getCached(USERS_FILE);
getCached(LOGS_FILE);
getCached(APIKEYS_FILE);

// ============================================================
// 用户管理
// ============================================================

function getUsers() {
    return getCached(USERS_FILE);
}

function getUserByToken(token) {
    if (!token) return null;
    const users = getUsers();
    return users.find((u) => u.enabled !== false && timingSafeCompare(u.token, token));
}

function createUser(name) {
    const users = getUsers();
    const user = {
        id: "u_" + crypto.randomBytes(6).toString("hex"),
        name,
        token: "sk-" + crypto.randomBytes(24).toString("hex"),
        createdAt: new Date().toISOString(),
        enabled: true,
    };
    users.push(user);
    setCached(USERS_FILE, users);
    return user;
}

function deleteUser(id) {
    let users = getUsers();
    const before = users.length;
    const filtered = users.filter((u) => u.id !== id);
    setCached(USERS_FILE, filtered);
    return filtered.length < before;
}

function toggleUser(id, enabled) {
    const users = getUsers();
    const user = users.find((u) => u.id === id);
    if (user) {
        user.enabled = enabled;
        setCached(USERS_FILE, users);
        return true;
    }
    return false;
}

// ============================================================
// API Key 池管理
// ============================================================

let _roundRobinIndex = 0;

function getApiKeys() {
    return getCached(APIKEYS_FILE);
}

function addApiKey(key, name) {
    const keys = getApiKeys();
    if (keys.some((k) => k.key === key)) {
        return null;
    }
    const entry = {
        id: "ak_" + crypto.randomBytes(6).toString("hex"),
        key,
        name: name || "API Key",
        createdAt: new Date().toISOString(),
        enabled: true,
        requestCount: 0,
    };
    keys.push(entry);
    setCached(APIKEYS_FILE, keys);
    return entry;
}

function deleteApiKey(id) {
    let keys = getApiKeys();
    const before = keys.length;
    const filtered = keys.filter((k) => k.id !== id);
    setCached(APIKEYS_FILE, filtered);
    return filtered.length < before;
}

function toggleApiKey(id, enabled) {
    const keys = getApiKeys();
    const key = keys.find((k) => k.id === id);
    if (key) {
        key.enabled = enabled;
        setCached(APIKEYS_FILE, keys);
        return true;
    }
    return false;
}

/**
 * 轮询获取下一个可用的 API Key（负载均衡）
 * 返回 { key, keyIndex, keyName } 或 null
 */
function getNextApiKey() {
    const keys = getApiKeys().filter((k) => k.enabled !== false);
    if (keys.length === 0) {
        const envKey = process.env.VERTEX_API_KEY;
        return envKey ? { key: envKey, keyIndex: 0, keyName: "ENV" } : null;
    }
    _roundRobinIndex = _roundRobinIndex % keys.length;
    const selected = keys[_roundRobinIndex];
    const keyIndex = _roundRobinIndex + 1;
    _roundRobinIndex = (_roundRobinIndex + 1) % keys.length;

    // 内存中更新计数（自动异步落盘）
    selected.requestCount = (selected.requestCount || 0) + 1;
    selected.lastUsedAt = new Date().toISOString();
    setCached(APIKEYS_FILE, getApiKeys());

    return { key: selected.key, keyIndex, keyName: selected.name || `Key-${keyIndex}` };
}

// ============================================================
// 调用记录
// ============================================================

const MAX_LOGS = 5000;

function addLog(entry) {
    const logs = getCached(LOGS_FILE);
    const log = {
        id: "l_" + crypto.randomBytes(6).toString("hex"),
        ...entry,
        timestamp: new Date().toISOString(),
    };
    logs.push(log);

    // 内存中截断
    if (logs.length > MAX_LOGS) {
        const trimmed = logs.slice(logs.length - MAX_LOGS);
        setCached(LOGS_FILE, trimmed);
    } else {
        setCached(LOGS_FILE, logs);
    }
    return log;
}

function getLogs(page = 1, pageSize = 50) {
    const logs = getCached(LOGS_FILE);
    const total = logs.length;
    // 倒序：最新的在前
    const start = Math.max(0, total - page * pageSize);
    const end = total - (page - 1) * pageSize;
    const data = logs.slice(start, end).reverse();
    return { data, total, page, pageSize };
}

function getLogById(id) {
    const logs = getCached(LOGS_FILE);
    return logs.find((l) => l.id === id) || null;
}

function getStats() {
    const logs = getCached(LOGS_FILE);

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalRequests = 0;

    const byUser = {};
    const byModel = {};
    const byDate = {};

    for (const log of logs) {
        totalPromptTokens += log.promptTokens || 0;
        totalCompletionTokens += log.completionTokens || 0;
        totalRequests++;

        const uid = log.userId || "anonymous";
        if (!byUser[uid]) {
            byUser[uid] = { name: log.userName || "匿名", requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        byUser[uid].requests++;
        byUser[uid].promptTokens += log.promptTokens || 0;
        byUser[uid].completionTokens += log.completionTokens || 0;
        byUser[uid].totalTokens += (log.promptTokens || 0) + (log.completionTokens || 0);

        const model = log.model || "unknown";
        if (!byModel[model]) {
            byModel[model] = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        byModel[model].requests++;
        byModel[model].promptTokens += log.promptTokens || 0;
        byModel[model].completionTokens += log.completionTokens || 0;
        byModel[model].totalTokens += (log.promptTokens || 0) + (log.completionTokens || 0);

        const date = log.timestamp ? log.timestamp.slice(0, 10) : "unknown";
        if (!byDate[date]) {
            byDate[date] = { requests: 0, totalTokens: 0 };
        }
        byDate[date].requests++;
        byDate[date].totalTokens += (log.promptTokens || 0) + (log.completionTokens || 0);
    }

    return {
        totalRequests,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        byUser: Object.entries(byUser).map(([id, v]) => ({ id, ...v })),
        byModel: Object.entries(byModel).map(([model, v]) => ({ model, ...v })),
        byDate: Object.entries(byDate)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-30)
            .map(([date, v]) => ({ date, ...v })),
    };
}

// ============================================================
// 安全工具函数
// ============================================================

/**
 * 使用 Hash 对齐长度，再进行恒定时间比较，防止时序攻击
 */
function timingSafeCompare(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    try {
        const bufA = crypto.createHash("sha256").update(a).digest();
        const bufB = crypto.createHash("sha256").update(b).digest();
        return crypto.timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
}

// 预热缓存
getCached(USERS_FILE);
getCached(LOGS_FILE);
getCached(APIKEYS_FILE);

// 如果 API Key 数据库为空，但环境变量中有 VERTEX_API_KEY，自动导入（防止初次部署报错）
const initialKeys = getApiKeys();
if (initialKeys.length === 0 && process.env.VERTEX_API_KEY) {
    addApiKey(process.env.VERTEX_API_KEY, ".env 默认配置");
}

module.exports = {
    getUsers,
    getUserByToken,
    createUser,
    deleteUser,
    toggleUser,
    addLog,
    getLogs,
    getLogById,
    getStats,
    getApiKeys,
    addApiKey,
    deleteApiKey,
    toggleApiKey,
    getNextApiKey,
    timingSafeCompare,
};
