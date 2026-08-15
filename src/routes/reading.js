const express = require('express');
const router = express.Router();
const { db, audit } = require('../db');
const { requireAuth } = require('./auth');

// ---------- 收藏 ----------
router.get('/bookshelf', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, b.added_at AS shelf_added_at,
      (SELECT chapter_id FROM reading_progress rp WHERE rp.novel_id = n.id AND rp.user_id = ?) AS last_chapter_id,
      (SELECT progress FROM reading_progress rp2 WHERE rp2.novel_id = n.id AND rp2.user_id = ?) AS progress
    FROM bookshelf b JOIN novels n ON n.id = b.novel_id
    WHERE b.user_id = ? ORDER BY b.added_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
  const items = rows.map(r => {
    let tags = []; try { tags = JSON.parse(r.tags || '[]'); } catch (e) {}
    return {
      id: r.id, title: r.title, author: r.author, description: r.description, tags,
      cover_url: r.cover_path ? `/api/files/${r.cover_path}` : null,
      status: r.status, words_count: r.words_count, chapter_count: r.chapter_count,
      in_shelf: true, last_chapter_id: r.last_chapter_id, progress: r.progress || 0,
      updated_at: r.updated_at,
    };
  });
  res.json({ items });
});

router.post('/bookshelf/:novelId', requireAuth, (req, res) => {
  const novel = db.prepare('SELECT id FROM novels WHERE id = ?').get(parseInt(req.params.novelId, 10));
  if (!novel) return res.status(404).json({ error: '小说不存在' });
  db.prepare('INSERT OR IGNORE INTO bookshelf (user_id, novel_id) VALUES (?, ?)').run(req.user.id, novel.id);
  res.json({ ok: true });
});

router.delete('/bookshelf/:novelId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookshelf WHERE user_id = ? AND novel_id = ?').run(req.user.id, parseInt(req.params.novelId, 10));
  res.json({ ok: true });
});

// ---------- 阅读进度 ----------
router.get('/progress/:novelId', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND novel_id = ?')
    .get(req.user.id, parseInt(req.params.novelId, 10));
  res.json({ progress: p || null });
});

router.put('/progress/:novelId', requireAuth, (req, res) => {
  const { chapter_id, progress } = req.body || {};
  const novelId = parseInt(req.params.novelId, 10);
  if (!db.prepare('SELECT id FROM novels WHERE id = ?').get(novelId)) return res.status(404).json({ error: '小说不存在' });
  const chId = chapter_id ? parseInt(chapter_id, 10) : null;
  // 校验 chapter_id 属于该小说（防脏数据）
  if (chId !== null) {
    const ch = db.prepare('SELECT id FROM chapters WHERE id = ? AND novel_id = ?').get(chId, novelId);
    if (!ch) return res.status(400).json({ error: '章节不属于该小说' });
  }
  const p = Math.max(0, Math.min(1, parseFloat(progress) || 0));
  db.prepare(`INSERT INTO reading_progress (user_id, novel_id, chapter_id, progress, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, novel_id) DO UPDATE SET
        chapter_id = excluded.chapter_id, progress = excluded.progress, updated_at = excluded.updated_at`)
    .run(req.user.id, novelId, chId, p);
  res.json({ ok: true });
});

// ---------- 最近阅读 ----------
router.get('/recent', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, rp.chapter_id AS last_chapter_id, rp.progress, rp.updated_at AS read_at
    FROM reading_progress rp JOIN novels n ON n.id = rp.novel_id
    WHERE rp.user_id = ? ORDER BY rp.updated_at DESC LIMIT 10
  `).all(req.user.id);
  const items = rows.map(r => {
    let tags = []; try { tags = JSON.parse(r.tags || '[]'); } catch (e) {}
    return {
      id: r.id, title: r.title, author: r.author, tags, words_count: r.words_count,
      chapter_count: r.chapter_count, cover_url: r.cover_path ? `/api/files/${r.cover_path}` : null,
      last_chapter_id: r.last_chapter_id, progress: r.progress || 0, read_at: r.read_at,
    };
  });
  res.json({ items });
});

// ---------- 统计（个人） ----------
router.get('/stats', requireAuth, (req, res) => {
  const shelfCount = db.prepare('SELECT COUNT(*) c FROM bookshelf WHERE user_id = ?').get(req.user.id).c;
  const readCount = db.prepare('SELECT COUNT(*) c FROM reading_progress WHERE user_id = ?').get(req.user.id).c;
  const readWords = db.prepare(`
    SELECT COALESCE(SUM(n.words_count), 0) s FROM reading_progress rp JOIN novels n ON n.id = rp.novel_id WHERE rp.user_id = ?
  `).get(req.user.id).s;
  res.json({ shelf_count: shelfCount, read_count: readCount, read_words: readWords });
});

module.exports = router;
