const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();
const { db, UPLOAD_DIR, audit } = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { rateLimit } = require('../security');
const { parseTxt } = require('../parsers/txt');
const { parseEpub } = require('../parsers/epub');

const MAX_TXT = 50 * 1024 * 1024;   // 50MB
const MAX_EPUB = 30 * 1024 * 1024;
const MAX_COVER = 5 * 1024 * 1024;
const MAX_CHAPTER_LEN = 2 * 1024 * 1024;

// 磁盘临时存储（避免大文件全量进内存，1.9GB 服务器防 OOM）
const os = require('os');
const TMP_UPLOAD = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-upload-'));
const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: TMP_UPLOAD,
    filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`),
  }),
  limits: { fileSize: Math.max(MAX_TXT, MAX_EPUB, MAX_COVER) },
});

// 并发上传信号量：同一时刻最多 2 个大文件解析，防内存峰值
let concurrentParses = 0;
const MAX_CONCURRENT_PARSE = 2;
function acquireParseSlot() {
  if (concurrentParses >= MAX_CONCURRENT_PARSE) {
    const err = new Error('服务器忙，请稍后再试');
    err.status = 429;
    throw err;
  }
  concurrentParses++;
}
function releaseParseSlot() { concurrentParses = Math.max(0, concurrentParses - 1); }

function safeUnlink(p) { try { fs.unlinkSync(p); } catch (e) {} }

// ---------- 工具 ----------
function tagsToArr(tags) {
  if (Array.isArray(tags)) return tags.map(String).filter(Boolean).slice(0, 10);
  if (typeof tags === 'string') return tags.split(/[,，\s]+/).filter(Boolean).slice(0, 10);
  return [];
}

function novelPublic(row, extra = {}) {
  if (!row) return null;
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch (e) {}
  return {
    id: row.id, title: row.title, author: row.author, description: row.description,
    tags, cover_url: row.cover_path ? `/api/files/${row.cover_path}` : null,
    status: row.status, words_count: row.words_count, chapter_count: row.chapter_count,
    created_at: row.created_at, updated_at: row.updated_at, ...extra,
  };
}

function recomputeNovel(novelId) {
  const r = db.prepare(
    'SELECT COUNT(*) c, COALESCE(SUM(words_count),0) w FROM chapters WHERE novel_id = ?'
  ).get(novelId);
  db.prepare('UPDATE novels SET chapter_count = ?, words_count = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(r.c, r.w, novelId);
}

// ---------- 列表 / 搜索 ----------
router.get('/', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const tag = String(req.query.tag || '').trim();
  const sort = String(req.query.sort || 'updated'); // updated | created | words | title
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));

  let where = '1=1';
  const params = [];
  if (q) {
    where += ' AND (title LIKE ? OR author LIKE ? OR description LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (tag) { where += ' AND tags LIKE ?'; params.push(`%"${tag}"%`); }

  const orderMap = {
    updated: 'n.updated_at DESC', created: 'n.created_at DESC',
    words: 'n.words_count DESC', title: 'n.title ASC',
  };
  const order = orderMap[sort] || orderMap.updated;

  // 附带收藏/进度状态
  const total = db.prepare(`SELECT COUNT(*) c FROM novels n WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT n.*,
      (SELECT COUNT(*) FROM bookshelf b WHERE b.novel_id = n.id AND b.user_id = ?) AS in_shelf,
      (SELECT chapter_id FROM reading_progress rp WHERE rp.novel_id = n.id AND rp.user_id = ?) AS last_chapter_id
    FROM novels n WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(req.user.id, req.user.id, ...params, pageSize, (page - 1) * pageSize);

  res.json({ total, page, pageSize, items: rows.map(r => novelPublic(r, { in_shelf: !!r.in_shelf, last_chapter_id: r.last_chapter_id })) });
});

// ---------- 创建（支持 TXT/EPUB 上传） ----------
router.post('/', requireAuth, uploadDisk.single('file'), (req, res) => {
  const { title, author = '', description = '', tags = [], status = 'published' } = req.body || {};
  if (!title || !String(title).trim()) {
    if (req.file) safeUnlink(req.file.path);
    return res.status(400).json({ error: '缺少书名' });
  }

  let chapters = [];
  if (req.file) {
    const tmpPath = req.file.path;
    try {
      acquireParseSlot();
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      if (ext === '.txt') {
        chapters = parseTxt(fs.readFileSync(tmpPath, 'utf8'));
      } else if (ext === '.epub') {
        const parsed = parseEpub(fs.readFileSync(tmpPath));
        chapters = parsed.chapters;
      } else {
        safeUnlink(tmpPath);
        releaseParseSlot();
        return res.status(400).json({ error: '仅支持 .txt / .epub 文件' });
      }
    } catch (e) {
      safeUnlink(tmpPath);
      releaseParseSlot();
      if (e.status === 429) return res.status(429).json({ error: e.message });
      return res.status(400).json({ error: `解析失败: ${e.message}` });
    }
    releaseParseSlot();
    safeUnlink(tmpPath);
    if (chapters.length === 0) return res.status(400).json({ error: '文件中没有可读内容' });
  }

  const titleClean = String(title).trim().slice(0, 120);
  const authorClean = String(author).trim().slice(0, 60);
  const tagArr = tagsToArr(tags);

  const tx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO novels (title, author, description, tags, status, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(titleClean, authorClean, String(description).slice(0, 5000), JSON.stringify(tagArr), status === 'draft' ? 'draft' : 'published', req.user.id);
    const novelId = info.lastInsertRowid;
    if (chapters.length) {
      const ins = db.prepare('INSERT INTO chapters (novel_id, idx, title, content, words_count) VALUES (?, ?, ?, ?, ?)');
      for (const ch of chapters) {
        ins.run(novelId, ch.idx, String(ch.title || `第 ${ch.idx + 1} 章`).slice(0, 120), ch.content.slice(0, MAX_CHAPTER_LEN), ch.words_count || ch.content.replace(/\s/g, '').length);
      }
      recomputeNovel(novelId);
    }
    return novelId;
  });

  const novelId = tx();
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
  audit(req.user, 'create_novel', `创建《${novel.title}》 (${chapters.length} 章)`, req.ip);
  res.status(201).json({ ok: true, novel: novelPublic(novel) });
});

// ---------- 详情 ----------
// 只支持书名（URL 友好）：/api/novels/冬日重现
function findNovel(param) {
  return db.prepare('SELECT * FROM novels WHERE title = ?').get(String(param || '').trim());
}

router.get('/:id', requireAuth, (req, res) => {
  const row = findNovel(req.params.id);
  if (!row) return res.status(404).json({ error: '小说不存在' });
  const shelf = db.prepare('SELECT 1 FROM bookshelf WHERE user_id = ? AND novel_id = ?').get(req.user.id, row.id);
  const prog = db.prepare('SELECT chapter_id, progress FROM reading_progress WHERE user_id = ? AND novel_id = ?').get(req.user.id, row.id);
  res.json({ novel: novelPublic(row, { in_shelf: !!shelf, ...(prog ? { last_chapter_id: prog.chapter_id, progress: prog.progress } : {}) }) });
});

// ---------- 更新元信息（管理员） ----------
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '小说不存在' });
  const { title, author, description, tags, status } = req.body || {};
  db.prepare(`UPDATE novels SET
      title = COALESCE(?, title), author = COALESCE(?, author),
      description = COALESCE(?, description), tags = COALESCE(?, tags),
      status = COALESCE(?, status), updated_at = datetime('now')
    WHERE id = ?`)
    .run(
      title !== undefined ? String(title).trim().slice(0, 120) : null,
      author !== undefined ? String(author).trim().slice(0, 60) : null,
      description !== undefined ? String(description).slice(0, 5000) : null,
      tags !== undefined ? JSON.stringify(tagsToArr(tags)) : null,
      status !== undefined ? (status === 'draft' ? 'draft' : 'published') : null,
      row.id
    );
  audit(req.user, 'update_novel', `编辑《${row.title}》`, req.ip);
  res.json({ ok: true, novel: novelPublic(db.prepare('SELECT * FROM novels WHERE id = ?').get(row.id)) });
});

// ---------- 删除（管理员） ----------
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '小说不存在' });
  db.prepare('DELETE FROM novels WHERE id = ?').run(row.id);
  // 清理封面文件
  if (row.cover_path) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.cover_path)); } catch (e) {}
  }
  audit(req.user, 'delete_novel', `删除《${row.title}》`, req.ip);
  res.json({ ok: true });
});

// ---------- 封面上传（管理员） ----------
router.post('/:id/cover', requireAuth, requireAdmin, uploadDisk.single('cover'), (req, res) => {
  const row = db.prepare('SELECT * FROM novels WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '小说不存在' });
  if (!req.file) return res.status(400).json({ error: '缺少封面文件' });
  const tmpPath = req.file.path;
  if (req.file.size > MAX_COVER) { safeUnlink(tmpPath); return res.status(400).json({ error: '封面不能超过 5MB' }); }
  const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  const ext = allowed[req.file.mimetype];
  if (!ext) { safeUnlink(tmpPath); return res.status(400).json({ error: '封面仅支持 JPG/PNG/WebP' }); }

  const fname = `cover_${row.id}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.copyFileSync(tmpPath, path.join(UPLOAD_DIR, fname));
  safeUnlink(tmpPath);
  if (row.cover_path) { try { fs.unlinkSync(path.join(UPLOAD_DIR, row.cover_path)); } catch (e) {} }
  db.prepare('UPDATE novels SET cover_path = ? WHERE id = ?').run(fname, row.id);
  audit(req.user, 'update_cover', `更新《${row.title}》封面`, req.ip);
  res.json({ ok: true, cover_url: `/api/files/${fname}` });
});

// ---------- 章节列表 ----------
router.get('/:id/chapters', requireAuth, (req, res) => {
  const row = findNovel(req.params.id);
  if (!row) return res.status(404).json({ error: '小说不存在' });
  const chapters = db.prepare('SELECT id, novel_id, idx, title, words_count FROM chapters WHERE novel_id = ? ORDER BY idx').all(row.id);
  res.json({ chapters });
});

// ---------- 章节详情 ----------
router.get('/:id/chapters/:cid', requireAuth, (req, res) => {
  const row = findNovel(req.params.id);
  if (!row) return res.status(404).json({ error: '小说不存在' });
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ? AND novel_id = ?').get(req.params.cid, row.id);
  if (!ch) return res.status(404).json({ error: '章节不存在' });
  // 记录阅读进度
  db.prepare(`INSERT INTO reading_progress (user_id, novel_id, chapter_id, progress, updated_at)
      VALUES (?, ?, ?, 0, datetime('now'))
      ON CONFLICT(user_id, novel_id) DO UPDATE SET chapter_id = excluded.chapter_id, updated_at = excluded.updated_at`)
    .run(req.user.id, row.id, ch.id);
  res.json({ chapter: { id: ch.id, novel_id: ch.novel_id, idx: ch.idx, title: ch.title, content: ch.content, words_count: ch.words_count } });
});

function rowId(id) { return parseInt(id, 10); }

// ---------- 编辑章节（管理员） ----------
router.put('/chapters/:cid', requireAuth, requireAdmin, (req, res) => {
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.cid);
  if (!ch) return res.status(404).json({ error: '章节不存在' });
  const { title, content } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE chapters SET title = ? WHERE id = ?').run(String(title).trim().slice(0, 120), ch.id);
  if (content !== undefined) {
    const c = String(content).slice(0, MAX_CHAPTER_LEN);
    db.prepare('UPDATE chapters SET content = ?, words_count = ? WHERE id = ?').run(c, c.replace(/\s/g, '').length, ch.id);
  }
  recomputeNovel(ch.novel_id);
  audit(req.user, 'update_chapter', `编辑章节 ${ch.id}`, req.ip);
  res.json({ ok: true });
});

// ---------- 新增章节（管理员） ----------
router.post('/chapters', requireAuth, requireAdmin, (req, res) => {
  const { novel_id, title, content = '', after_idx } = req.body || {};
  const novel = db.prepare('SELECT id FROM novels WHERE id = ?').get(parseInt(novel_id, 10));
  if (!novel) return res.status(404).json({ error: '小说不存在' });
  const maxIdx = db.prepare('SELECT COALESCE(MAX(idx), -1) m FROM chapters WHERE novel_id = ?').get(novel.id).m;
  const idx = after_idx !== undefined ? Math.max(0, Math.min(parseInt(after_idx, 10) + 1, maxIdx + 1)) : maxIdx + 1;
  const tx = db.transaction(() => {
    db.prepare('UPDATE chapters SET idx = idx + 1 WHERE novel_id = ? AND idx >= ?').run(novel.id, idx);
    db.prepare('INSERT INTO chapters (novel_id, idx, title, content, words_count) VALUES (?, ?, ?, ?, ?)')
      .run(novel.id, idx, String(title || `第 ${idx + 1} 章`).slice(0, 120), String(content).slice(0, MAX_CHAPTER_LEN), String(content).replace(/\s/g, '').length);
  });
  tx();
  recomputeNovel(novel.id);
  audit(req.user, 'add_chapter', `《${novel.id}》新增章节`, req.ip);
  res.json({ ok: true });
});

// ---------- 删除章节（管理员） ----------
router.delete('/chapters/:cid', requireAuth, requireAdmin, (req, res) => {
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.cid);
  if (!ch) return res.status(404).json({ error: '章节不存在' });
  db.prepare('DELETE FROM chapters WHERE id = ?').run(ch.id);
  db.prepare('UPDATE chapters SET idx = idx - 1 WHERE novel_id = ? AND idx > ?').run(ch.novel_id, ch.idx);
  recomputeNovel(ch.novel_id);
  audit(req.user, 'delete_chapter', `删除章节 ${ch.id}`, req.ip);
  res.json({ ok: true });
});

// ---------- 导出下载 ----------
router.get('/:id/download', requireAuth, (req, res) => {
  const novel = findNovel(req.params.id);
  if (!novel) return res.status(404).json({ error: '小说不存在' });
  const chapters = db.prepare('SELECT idx, title, content FROM chapters WHERE novel_id = ? ORDER BY idx').all(novel.id);
  const format = String(req.query.format || 'txt').toLowerCase();
  const safeName = (novel.title || 'novel').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const filename = `${safeName}.${format === 'epub' ? 'epub' : 'txt'}`;

  if (format === 'epub') {
    // 简单 EPUB：zip 容器 + XHTML 章节
    const epub = buildEpub(novel, chapters);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(epub);
  } else {
    // TXT：书名 + 作者 + 章节
    let text = `${novel.title}\n作者：${novel.author || '佚名'}\n`;
    if (novel.description) text += `简介：${novel.description}\n`;
    text += '\n' + chapters.map(c => `\n${c.title}\n\n${c.content}`).join('\n') + '\n';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(text);
  }
  audit(req.user, 'download_novel', `下载《${novel.title}》(${format})`, req.ip);
});

// 简单 EPUB 构建器（无外部依赖，最小合法 EPUB3）
function buildEpub(novel, chapters) {
  const uuid = `urn:uuid:${require('crypto').randomUUID()}`;
  const safeTitle = (novel.title || 'novel').replace(/[&<>"]/g, '');
  const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>${escapeXml(title)}</title></head>
<body><h1>${escapeXml(title)}</h1>${body}</body>
</html>`;
  const escapeXml = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

  const chapterDocs = chapters.map((c, i) => ({
    id: `ch${i + 1}`,
    href: `ch${i + 1}.xhtml`,
    title: c.title,
    content: xhtml(c.title, c.content.split('\n').map(p => `<p>${escapeXml(p)}</p>`).join('')),
  }));
  const spine = chapterDocs.map(c => `    <itemref idref="${c.id}"/>`).join('\n');
  const manifest = chapterDocs.map(c => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('\n');
  const navItems = chapterDocs.map(c => `<li><a href="${c.href}">${escapeXml(c.title)}</a></li>`).join('\n');

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uuid}</dc:identifier>
    <dc:title>${escapeXml(novel.title)}</dc:title>
    <dc:creator>${escapeXml(novel.author || '佚名')}</dc:creator>
    <dc:language>zh-CN</dc:language>
    ${novel.description ? `<dc:description>${escapeXml(novel.description)}</dc:description>` : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
  const navDoc = xhtml('目录', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${navItems}</ol></nav>`);

  // zip 打包（STORE 无压缩，合法 EPUB）
  const { crc32 } = require('zlib');
  const files = [
    { path: 'mimetype', data: Buffer.from('application/epub+zip') },
    { path: 'META-INF/container.xml', data: Buffer.from(containerXml) },
    { path: 'OEBPS/content.opf', data: Buffer.from(contentOpf) },
    { path: 'OEBPS/nav.xhtml', data: Buffer.from(navDoc) },
    ...chapterDocs.map(c => ({ path: `OEBPS/${c.href}`, data: Buffer.from(c.content) })),
  ];
  let out = Buffer.alloc(0);
  const localHeader = (path, data) => {
    const name = Buffer.from(path, 'utf8');
    const crc = crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);       // local file header sig
    h.writeUInt16LE(20, 4);               // version
    h.writeUInt16LE(0x0800, 6);           // UTF-8 flag
    h.writeUInt16LE(0, 8);                // method: store
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12); // mod time/date
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);     // comp size
    h.writeUInt32LE(data.length, 22);     // uncomp size
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    return Buffer.concat([h, name, data]);
  };
  files.forEach(f => { out = Buffer.concat([out, localHeader(f.path, f.data)]); });
  // central directory
  let central = Buffer.alloc(0);
  let offset = 0;
  files.forEach(f => {
    const name = Buffer.from(f.path, 'utf8');
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12);
    h.writeUInt32LE(crc, 16);
    h.writeUInt32LE(f.data.length, 20);
    h.writeUInt32LE(f.data.length, 24);
    h.writeUInt16LE(name.length, 28);
    h.writeUInt16LE(0, 30); h.writeUInt16LE(0, 32); h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36);
    h.writeUInt32LE(offset, 42);
    central = Buffer.concat([central, h, name]);
    offset += 30 + name.length + f.data.length;
  });
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([out, central, end]);
}

module.exports = router;