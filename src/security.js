const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { db } = require('./db');

// ---------------- 密码哈希 (scrypt) ----------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return `${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [N, r, p, salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: Number(N), r: Number(r), p: Number(p) }).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(test, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// ---------------- 2FA (TOTP) ----------------
function generateTOTPSecret(username) {
  const secret = speakeasy.generateSecret({ name: `NovelSite:${username}` });
  return { base32: secret.base32, otpauth_url: secret.otpauth_url };
}

function verifyTOTP(secret, token) {
  if (!secret || !token) return false;
  return speakeasy.totp.verify({
    secret, encoding: 'base32', token: String(token).trim().replace(/\s/g, ''), window: 1
  });
}

function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, 10).replace(/-/g, 'X'));
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).toUpperCase()).digest('hex');
}

// 校验恢复码：成功则移除该码，返回 true
function consumeRecoveryCode(user, code) {
  const codes = JSON.parse(user.recovery_codes || '[]');
  const h = hashRecoveryCode(code);
  const i = codes.indexOf(h);
  if (i === -1) return false;
  codes.splice(i, 1);
  db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes), user.id);
  return true;
}

// ---------------- CSRF (double-submit cookie + header) ----------------
const CSRF_COOKIE = 'csrf_token';
function csrfToken() { return crypto.randomBytes(32).toString('hex'); }

function csrfProtection(req, res, next) {
  const cookieTok = req.cookies?.[CSRF_COOKIE];
  if (!cookieTok) {
    const tok = csrfToken();
    res.cookie(CSRF_COOKIE, tok, { httpOnly: false, sameSite: 'lax', secure: req.secure });
    return next();
  }
  next();
}

// 对写操作(mutating)校验：header X-CSRF-Token 必须等于 cookie
function csrfRequired(req, res, next) {
  const cookieTok = req.cookies?.[CSRF_COOKIE];
  const headerTok = req.headers['x-csrf-token'];
  if (!cookieTok || !headerTok || !crypto.timingSafeEqual(Buffer.from(cookieTok), Buffer.from(headerTok))) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
}

// ---------------- 限流 (内存滑动窗口) ----------------
const rateBuckets = new Map(); // key -> {count, resetAt}
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, keyPrefix = 'rl' } = {}) {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `请求过于频繁，请 ${retryAfter} 秒后再试` });
    }
    next();
  };
}

// 周期性清理限流桶
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.resetAt < now) rateBuckets.delete(k);
}, 60 * 1000).unref();

// ---------------- 登录失败锁定 ----------------
const loginFails = new Map(); // username -> {count, lockedUntil}
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

function recordLoginFail(username) {
  const e = loginFails.get(username) || { count: 0, lockedUntil: 0 };
  e.count += 1;
  if (e.count >= MAX_FAILS) e.lockedUntil = Date.now() + LOCK_MS;
  loginFails.set(username, e);
}
function clearLoginFails(username) { loginFails.delete(username); }
function isLoginLocked(username) {
  const e = loginFails.get(username);
  if (!e) return false;
  if (e.lockedUntil > Date.now()) return true;
  if (e.lockedUntil && e.lockedUntil <= Date.now()) loginFails.delete(username);
  return false;
}

// ---------------- SQLite session store (express-session) ----------------
const session = require('express-session');
class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expire = (sess.cookie && sess.cookie.expires) ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 864e5;
      db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire')
        .run(sid, JSON.stringify(sess), expire);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(null); } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const expire = (sess.cookie && sess.cookie.expires) ? new Date(sess.cookie.expires).getTime() : Date.now() + 7 * 864e5;
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(expire, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}
const sqliteSessionStore = new SqliteSessionStore();

// ---------------- 公共工具 ----------------
function sanitizeUser(u) {
  return {
    id: u.id, username: u.username, role: u.role,
    twofa_enabled: !!u.twofa_enabled, status: u.status,
    created_at: u.created_at, last_login_at: u.last_login_at
  };
}

function jsonBody(res, status, data) { return res.status(status).json(data); }

module.exports = {
  hashPassword, verifyPassword,
  generateTOTPSecret, verifyTOTP, generateRecoveryCodes, hashRecoveryCode, consumeRecoveryCode,
  csrfProtection, csrfRequired, CSRF_COOKIE,
  rateLimit, recordLoginFail, clearLoginFails, isLoginLocked,
  sqliteSessionStore, sanitizeUser, jsonBody,
};
