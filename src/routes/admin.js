const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const archiver = require('archiver');
const router = express.Router();
const { db, DATA_DIR, UPLOAD_DIR, BACKUP_DIR, BOOKS_DIR, getSetting, setSetting, audit } = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { hashPassword } = require('../security');

const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD || 'change-me';
const MAX_RESTORE = 200 * 1024 * 1024;
const uploadRestore = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESTORE } });

// ---------- 统计 ----------
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const novels = db.prepare('SELECT COUNT(*) c FROM novels').get().c;
  const chapters = db.prepare('SELECT COUNT(*) c FROM chapters').get().c;
  const words = db.prepare('SELECT COALESCE(SUM(words_count),0) s FROM novels').get().s;
  const uploads = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
  const dbSize = fs.statSync(path.join(DATA_DIR, 'novel.db')).size;
  res.json({ users, novels, chapters, words, uploads, db_size: dbSize });
});

// ---------- 用户管理 ----------
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, twofa_enabled, status, created_at, last_login_at FROM users ORDER BY id').all();
  res.json({ users });
});

router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.id === req.user.id && req.body.role && req.body.role !== 'admin') {
    return res.status(400).json({ error: '不能取消自己的管理员权限' });
  }
  const { role, status } = req.body || {};
  if (role !== undefined && !['user', 'admin'].includes(role)) return res.status(400).json({ error: '非法角色' });
  if (status !== undefined && !['active', 'disabled'].includes(status)) return res.status(400).json({ error: '非法状态' });
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  if (status !== undefined) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
  if (status === 'disabled') {
    // 立即撤销该用户所有会话
    const rows = db.prepare('SELECT sid, sess FROM sessions').all();
    for (const r of rows) {
      try { const s = JSON.parse(r.sess); if (s.userId === user.id) db.prepare('DELETE FROM sessions WHERE sid = ?').run(r.sid); } catch (e) {}
    }
  }
  audit(req.user, 'admin_update_user', `修改用户 ${user.username}: ${JSON.stringify(req.body)}`, req.ip);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
  if (!/[a-zA-Z]/.test(new_password) || !/[0-9]/.test(new_password)) return res.status(400).json({ error: '新密码需同时包含字母和数字' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), user.id);
  audit(req.user, 'admin_reset_password', `重置用户 ${user.username} 密码`, req.ip);
  res.json({ ok: true });
});

// ---------- 站点设置 ----------
router.get('/settings', requireAuth, requireAdmin, (req, res) => {
  res.json({
    allow_register: getSetting('allow_register', 'true'),
    site_name: getSetting('site_name', '喵的书架'),
  });
});

router.put('/settings', requireAuth, requireAdmin, (req, res) => {
  const { allow_register, site_name } = req.body || {};
  if (allow_register !== undefined) setSetting('allow_register', allow_register ? 'true' : 'false');
  if (site_name !== undefined) setSetting('site_name', String(site_name).trim().slice(0, 60) || '喵的书架');
  audit(req.user, 'admin_settings', `更新设置: ${JSON.stringify(req.body)}`, req.ip);
  res.json({ ok: true });
});

// ---------- 审计日志 ----------
router.get('/logs', requireAuth, requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));
  const total = db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c;
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, logs });
});

// ---------- 备份：创建 ----------
router.post('/backup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const zipPath = path.join(BACKUP_DIR, `backup-${stamp}.zip`);
    // 先把 db 做一致性快照（WAL 模式下复制主库 + wal）
    const snapDir = path.join(DATA_DIR, '.snap');
    if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir);
    db.prepare('VACUUM INTO ?').run(path.join(snapDir, 'novel.db'));
    await zipDir(zipPath, snapDir, UPLOAD_DIR, BOOKS_DIR);
    const size = fs.statSync(zipPath).size;
    audit(req.user, 'backup', `创建备份 ${path.basename(zipPath)} (${size} bytes)`, req.ip);
    res.json({ ok: true, file: path.basename(zipPath), size });
  } catch (e) {
    res.status(500).json({ error: `备份失败: ${e.message}` });
  }
});

// 把目录打成加密 zip（AES-256-GCM，口令来自 BACKUP_PASSWORD）
// 打包：novel.db 快照 + uploads/（封面）+ books/（正文 TXT）
function zipDir(zipPath, snapDir, uploadDir, booksDir) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const out = fs.createWriteStream(zipPath);
    out.on('close', resolve);
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    archive.file(path.join(snapDir, 'novel.db'), { name: 'novel.db' });
    if (fs.existsSync(uploadDir)) {
      archive.directory(uploadDir, 'uploads');
    }
    if (fs.existsSync(booksDir)) {
      archive.directory(booksDir, 'books');
    }
    archive.append(Buffer.from(JSON.stringify({
      site_name: getSetting('site_name', '喵的书架'),
      allow_register: getSetting('allow_register', 'true'),
      created_at: new Date().toISOString(),
    })), { name: 'meta.json' });
    archive.finalize();
  }).then(() => encryptFile(zipPath));
}

function encryptFile(filePath) {
  const data = fs.readFileSync(filePath);
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(String(BACKUP_PASSWORD)).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(filePath + '.enc', Buffer.concat([iv, tag, enc]));
  fs.unlinkSync(filePath);
  fs.renameSync(filePath + '.enc', filePath);
}

function decryptFile(data) {
  const key = crypto.createHash('sha256').update(String(BACKUP_PASSWORD)).digest();
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const enc = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

// ---------- 备份：列表/下载 ----------
router.get('/backup', requireAuth, requireAdmin, (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.zip')).map(f => {
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { file: f, size: st.size, mtime: st.mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

router.get('/backup/download/:file', requireAuth, requireAdmin, (req, res) => {
  const f = path.basename(req.params.file);
  const fp = path.join(BACKUP_DIR, f);
  if (!f.endsWith('.zip') || !fs.existsSync(fp)) return res.status(404).json({ error: '备份不存在' });
  res.download(fp, f);
});

router.delete('/backup/:file', requireAuth, requireAdmin, (req, res) => {
  const f = path.basename(req.params.file);
  const fp = path.join(BACKUP_DIR, f);
  if (!f.endsWith('.zip') || !fs.existsSync(fp)) return res.status(404).json({ error: '备份不存在' });
  fs.unlinkSync(fp);
  audit(req.user, 'backup_delete', `删除备份 ${f}`, req.ip);
  res.json({ ok: true });
});

// ---------- 备份：恢复（危险操作，需二次确认 token） ----------
router.post('/restore', requireAuth, requireAdmin, uploadRestore.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少备份文件' });
  const { confirm } = req.body || {};
  if (confirm !== 'RESTORE') return res.status(400).json({ error: '请输入确认口令 RESTORE' });

  let zipBuf;
  try { zipBuf = decryptFile(req.file.buffer); } catch (e) { return res.status(400).json({ error: '解密失败：备份口令错误或文件损坏' }); }

  // 用系统 unzip 解压到临时目录
  const tmp = path.join(DATA_DIR, '.restore_tmp');
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'backup.zip'), zipBuf);
  const { execSync } = require('child_process');
  try { execSync(`cd ${tmp} && unzip -o backup.zip`, { stdio: 'pipe' }); } catch (e) {
    return res.status(400).json({ error: '备份文件不是有效压缩包' });
  }
  if (!fs.existsSync(path.join(tmp, 'novel.db'))) return res.status(400).json({ error: '备份缺少数据库文件' });

  // 安全备份当前数据后替换
  const swapDir = path.join(DATA_DIR, '.swap_' + Date.now());
  fs.mkdirSync(swapDir, { recursive: true });
  db.close();
  try {
    fs.renameSync(path.join(DATA_DIR, 'novel.db'), path.join(swapDir, 'novel.db'));
    if (fs.existsSync(path.join(DATA_DIR, 'novel.db-wal'))) fs.renameSync(path.join(DATA_DIR, 'novel.db-wal'), path.join(swapDir, 'novel.db-wal'));
    if (fs.existsSync(path.join(DATA_DIR, 'novel.db-shm'))) fs.renameSync(path.join(DATA_DIR, 'novel.db-shm'), path.join(swapDir, 'novel.db-shm'));
    if (fs.existsSync(UPLOAD_DIR)) fs.renameSync(UPLOAD_DIR, path.join(swapDir, 'uploads'));
    fs.renameSync(path.join(tmp, 'novel.db'), path.join(DATA_DIR, 'novel.db'));
    if (fs.existsSync(path.join(tmp, 'uploads'))) fs.renameSync(path.join(tmp, 'uploads'), UPLOAD_DIR);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    // 恢复正文 TXT（books/）
    if (fs.existsSync(path.join(tmp, 'books'))) {
      if (fs.existsSync(BOOKS_DIR)) fs.renameSync(BOOKS_DIR, path.join(swapDir, 'books'));
      fs.renameSync(path.join(tmp, 'books'), BOOKS_DIR);
    }
    if (!fs.existsSync(BOOKS_DIR)) fs.mkdirSync(BOOKS_DIR, { recursive: true });
  } catch (e) {
    // 回滚
    if (!fs.existsSync(path.join(DATA_DIR, 'novel.db')) && fs.existsSync(path.join(swapDir, 'novel.db'))) {
      fs.renameSync(path.join(swapDir, 'novel.db'), path.join(DATA_DIR, 'novel.db'));
    }
    return res.status(500).json({ error: `恢复失败: ${e.message}` });
  }
  // 重新打开数据库（db 模块是单例，这里需要重新 require 会拿旧连接，所以直接重启提示）
  audit(null, 'restore', `恢复备份完成（服务重启后生效）`, req.ip);
  res.json({ ok: true, message: '数据已恢复，服务即将自动重启' });
  // 触发优雅退出，由进程管理器/容器重启
  setTimeout(() => process.exit(0), 800);
});

// ---------- 手动刮削（管理员）：LLM 补全某本书的简介/标签 ----------
router.post('/scrape/:novelId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { scrapeNovel, SCRAPE_ENABLED } = require('../scrape');
    if (!SCRAPE_ENABLED) return res.status(400).json({ error: '未配置 DEEPSEEK_API_KEY，无法刮削' });
    const result = await scrapeNovel(parseInt(req.params.novelId, 10));
    if (!result.ok) return res.status(400).json({ error: result.error });
    audit(req.user, 'scrape', `刮削《${result.title || ''}》`, req.ip);
    res.json({ ok: true, description: result.description, tags: result.tags });
  } catch (e) {
    res.status(500).json({ error: `刮削失败: ${e.message}` });
  }
});

module.exports = router;
