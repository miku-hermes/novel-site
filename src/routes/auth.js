const express = require('express');
const router = express.Router();
const qrcode = require('qrcode');
const { db, getSetting, audit } = require('../db');
const {
  hashPassword, verifyPassword,
  generateTOTPSecret, verifyTOTP, generateRecoveryCodes, hashRecoveryCode, consumeRecoveryCode,
  rateLimit, recordLoginFail, clearLoginFails, isLoginLocked,
  sanitizeUser, csrfRequired,
} = require('../security');

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/;
const PASSWORD_MIN = 8;

// 登录后临时令牌（等待 2FA），内存 5 分钟有效
const pending2fa = new Map(); // token -> {userId, expires}
const PENDING_TTL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending2fa) if (v.expires < now) pending2fa.delete(k);
}, 60 * 1000).unref();

function issuePending(user) {
  const token = require('crypto').randomBytes(32).toString('hex');
  pending2fa.set(token, { userId: user.id, expires: Date.now() + PENDING_TTL });
  return token;
}
function consumePending(token) {
  const v = pending2fa.get(token);
  if (!v || v.expires < Date.now()) return null;
  pending2fa.delete(token);
  return v;
}

function finalizeLogin(req, res, user) {
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: '会话创建失败' });
    req.session.userId = user.id;
    req.session.role = user.role;
    db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id);
    clearLoginFails(user.username);
    audit(user, 'login', '登录成功', req.ip);
    res.json({ ok: true, user: sanitizeUser(user) });
  });
}

// 需要登录
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '未登录' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.status !== 'active') {
    req.session.destroy(() => {});
    return res.status(401).json({ error: '账号不可用' });
  }
  req.user = user;
  next();
}
// 需要管理员
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// ---------------- 注册 ----------------
router.post('/register', rateLimit({ max: 10, keyPrefix: 'reg' }), (req, res) => {
  if (getSetting('allow_register', 'true') !== 'true') {
    return res.status(403).json({ error: '当前站点已关闭注册' });
  }
  const { username, password } = req.body || {};
  if (!username || !USERNAME_RE.test(username)) return res.status(400).json({ error: '用户名需 2-20 位，仅限字母/数字/下划线/中文' });
  if (!password || password.length < PASSWORD_MIN) return res.status(400).json({ error: `密码至少 ${PASSWORD_MIN} 位` });
  if (password.length > 128) return res.status(400).json({ error: '密码过长' });
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: '密码需同时包含字母和数字' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '用户名已存在' });

  const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), 'user');
  // 首个用户自动成为管理员（事务包裹，防并发注册双管理员竞态）
  const tx = db.transaction(() => {
    const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
    if (count === 1) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', info.lastInsertRowid);
    }
  });
  tx();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  audit(user, 'register', '注册成功（自动分配管理员）', req.ip);
  res.status(201).json({ ok: true, message: '注册成功', is_admin: user.role === 'admin' });
});

// ---------------- 登录（含 2FA 流程） ----------------
router.post('/login', rateLimit({ max: 30, keyPrefix: 'login' }), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  if (isLoginLocked(username)) return res.status(423).json({ error: '失败次数过多，账号已锁定 15 分钟' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
  // 统一错误，避免枚举用户名
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFail(username);
    audit(null, 'login_fail', `登录失败: ${username}`, req.ip);
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: '账号已被禁用' });

  if (!user.twofa_enabled) {
    // 未绑定 2FA：先要求绑定（强制），再完成登录
    return res.json({ need_2fa_setup: true, pending_token: issuePending(user) });
  }
  // 已绑定：等待 TOTP 验证
  return res.json({ need_2fa: true, pending_token: issuePending(user) });
});

// ---------------- 验证 2FA 并完成登录 ----------------
router.post('/verify-2fa', rateLimit({ max: 20, keyPrefix: '2fa' }), (req, res) => {
  const { pending_token, code } = req.body || {};
  const pend = pending2fa.get(pending_token);
  if (!pend || pend.expires < Date.now()) return res.status(400).json({ error: '验证会话已过期，请重新登录' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
  if (!user || user.status !== 'active') return res.status(401).json({ error: '账号不可用' });

  const c = String(code || '').trim();
  if (verifyTOTP(user.twofa_secret, c)) {
    consumePending(pending_token);
    return finalizeLogin(req, res, user);
  }
  if (consumeRecoveryCode(user, c)) {
    consumePending(pending_token);
    audit(user, 'login_recovery', '使用恢复码登录', req.ip);
    return finalizeLogin(req, res, user);
  }
  audit(user, 'login_fail_2fa', '2FA 验证码错误', req.ip);
  return res.status(401).json({ error: '验证码错误' });
});

// ---------------- 绑定 2FA（登录前强制绑定流程使用） ----------------
// step1: 获取 secret + QR（需要 pending token）
router.post('/setup-2fa', rateLimit({ max: 10, keyPrefix: 'setup2fa' }), (req, res) => {
  const { pending_token } = req.body || {};
  const pend = pending2fa.get(pending_token);
  if (!pend || pend.expires < Date.now()) return res.status(400).json({ error: '会话已过期，请重新登录' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
  if (!user) return res.status(401).json({ error: '账号不可用' });
  if (user.twofa_enabled) return res.status(400).json({ error: '已绑定 2FA' });

  const { base32, otpauth_url } = generateTOTPSecret(user.username);
  // 暂存到 pending 记录
  pend.secret = base32;
  pending2fa.set(pending_token, pend);
  qrcode.toDataURL(otpauth_url, { margin: 1 }, (err, url) => {
    if (err) return res.status(500).json({ error: '生成二维码失败' });
    res.json({ secret: base32, qr: url });
  });
});

// step2: 确认绑定，返回恢复码
router.post('/enable-2fa', rateLimit({ max: 10, keyPrefix: 'enable2fa' }), (req, res) => {
  const { pending_token, code } = req.body || {};
  const pend = pending2fa.get(pending_token);
  if (!pend || pend.expires < Date.now()) return res.status(400).json({ error: '会话已过期，请重新登录' });
  if (!pend.secret) return res.status(400).json({ error: '请先获取二维码' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pend.userId);
  if (!user || user.status !== 'active') return res.status(401).json({ error: '账号不可用' });
  if (user.twofa_enabled) return res.status(400).json({ error: '已绑定 2FA' });

  if (!verifyTOTP(pend.secret, String(code || '').trim())) {
    return res.status(401).json({ error: '验证码错误' });
  }
  consumePending(pending_token);
  const recovery = generateRecoveryCodes(10);
  const hashed = recovery.map(hashRecoveryCode);
  db.prepare('UPDATE users SET twofa_secret = ?, twofa_enabled = 1, recovery_codes = ? WHERE id = ?')
    .run(pend.secret, JSON.stringify(hashed), user.id);
  user.twofa_secret = pend.secret;
  user.twofa_enabled = 1;
  user.recovery_codes = JSON.stringify(hashed);
  audit(user, 'enable_2fa', '已绑定 2FA', req.ip);
  res.json({ ok: true, recovery_codes: recovery });
});

// ---------------- 已登录用户操作 ----------------
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

router.post('/logout', requireAuth, csrfRequired, (req, res) => {
  audit(req.user, 'logout', '退出登录', req.ip);
  req.session.destroy(() => res.json({ ok: true }));
});

// 修改密码
router.post('/change-password', requireAuth, csrfRequired, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!verifyPassword(old_password || '', req.user.password_hash)) {
    return res.status(401).json({ error: '原密码错误' });
  }
  if (!new_password || new_password.length < PASSWORD_MIN) return res.status(400).json({ error: `新密码至少 ${PASSWORD_MIN} 位` });
  if (!/[a-zA-Z]/.test(new_password) || !/[0-9]/.test(new_password)) return res.status(400).json({ error: '新密码需同时包含字母和数字' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  // 撤销该用户所有其他会话（保留当前会话）
  const rows = db.prepare('SELECT sid, sess FROM sessions').all();
  for (const r of rows) {
    try {
      const s = JSON.parse(r.sess);
      if (s.userId === req.user.id && r.sid !== req.sessionID) db.prepare('DELETE FROM sessions WHERE sid = ?').run(r.sid);
    } catch (e) {}
  }
  audit(req.user, 'change_password', '修改密码', req.ip);
  res.json({ ok: true });
});

// 已登录：绑定/重新生成恢复码（需要 TOTP 验证）
router.post('/regenerate-recovery', requireAuth, csrfRequired, (req, res) => {
  const { code } = req.body || {};
  if (!verifyTOTP(req.user.twofa_secret, String(code || '').trim())) {
    return res.status(401).json({ error: '2FA 验证码错误' });
  }
  const recovery = generateRecoveryCodes(10);
  db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(recovery.map(hashRecoveryCode)), req.user.id);
  audit(req.user, 'regenerate_recovery', '重新生成恢复码', req.ip);
  res.json({ ok: true, recovery_codes: recovery });
});

// 已登录：关闭 2FA（需要验证当前 TOTP 码）
router.post('/disable-2fa', requireAuth, csrfRequired, rateLimit({ max: 10, keyPrefix: 'disable2fa' }), (req, res) => {
  if (!req.user.twofa_enabled) return res.status(400).json({ error: '当前未开启两步验证' });
  const { code } = req.body || {};
  if (!verifyTOTP(req.user.twofa_secret, String(code || '').trim())) {
    return res.status(401).json({ error: '2FA 验证码错误' });
  }
  db.prepare('UPDATE users SET twofa_secret = NULL, twofa_enabled = 0, recovery_codes = NULL WHERE id = ?').run(req.user.id);
  audit(req.user, 'disable_2fa', '关闭两步验证', req.ip);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin };
