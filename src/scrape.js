// 刮削模块：自动补全书籍元数据（简介/标签/作者/封面）
// 数据源（级联）：
//   1. 起点中文网（真实书库，经 Camofox 反检测浏览器）——优先
//   2. DeepSeek LLM（书名+正文片段生成）——回退
// 封面：起点返回封面 URL，LLM 路径用前端渐变占位

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const SCRAPE_ENABLED = !!DEEPSEEK_API_KEY;

// 从正文开头提取用于刮削的样本（首章前 1500 字，去重）
function extractSample(chapters) {
  if (!chapters || !chapters.length) return '';
  const first = String(chapters[0].content || '').trim();
  return first.slice(0, 1500);
}

// 从文件名/元数据提取作者
function extractAuthorFromName(title) {
  const dash = title.lastIndexOf(' - ');
  if (dash > 0) return { title: title.slice(0, dash).trim(), author: title.slice(dash + 3).trim() };
  return { title, author: '' };
}

/**
 * 刮削主入口（级联）：起点 → LLM
 * @param {string} title 书名
 * @param {string} author 已知作者（可为空）
 * @param {Array} chapters 章节数组（LLM 回退用正文样本）
 * @returns {Promise<{description, tags, author, cover_url, source}>}
 */
async function scrapeMetadata(title, author, chapters) {
  // 1. 起点刮削（真实书库，优先）
  try {
    const { scrapeQidian } = require('./scrape-qidian');
    const q = await scrapeQidian(title);
    if (q.ok) {
      return {
        description: q.description || '',
        tags: q.tags || [],
        author: q.author || author || '',
        cover_url: q.cover_url || '',
        source: 'qidian',
      };
    }
  } catch (e) { /* 起点失败回退 LLM */ }

  // 2. LLM 生成（回退）
  const llm = await scrapeByLLM(title, author, chapters);
  return { ...llm, source: llm.description || llm.tags.length ? 'llm' : '' };
}

async function scrapeByLLM(title, author, chapters) {
  if (!SCRAPE_ENABLED) return { description: '', tags: [], author: author || '', cover_url: '' };
  const sample = extractSample(chapters);
  if (!sample) return { description: '', tags: [], author: author || '', cover_url: '' };

  const prompt = `你是一个小说元数据助手。根据以下信息为小说生成简介和标签。
书名：${title}
${author ? '作者：' + author : ''}
正文开头片段：
${sample.slice(0, 1000)}

请严格输出 JSON（不要 markdown 代码块），格式：
{"description": "150字以内的简介", "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"]}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000); // 20s 超时
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return { description: '', tags: [], author: author || '', cover_url: '' };
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      description: String(parsed.description || '').slice(0, 5000),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8).map(String).slice(0, 20) : [],
      author: author || '',
      cover_url: '',
    };
  } catch (e) {
    return { description: '', tags: [], author: author || '', cover_url: '' }; // 刮削失败不阻塞主流程
  }
}

// 给已有书籍补全元数据（管理后台手动触发）
async function scrapeNovel(novelId) {
  const db = require('./db').db;
  const fs = require('fs');
  const path = require('path');
  const { BOOKS_DIR } = require('./db');
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
  if (!novel) return { ok: false, error: '小说不存在' };
  const chapters = db.prepare('SELECT content, file_path FROM chapters WHERE novel_id = ? ORDER BY idx LIMIT 5').all(novelId);
  // 章节正文可能在文件里：file_path 是相对路径 books/<书名>/<idx>.txt
  for (const c of chapters) {
    if (!c.content && c.file_path) {
      const rel = String(c.file_path).replace(/^books[\\/]/, '');
      const abs = path.join(BOOKS_DIR, rel);
      if (fs.existsSync(abs)) c.content = fs.readFileSync(abs, 'utf8');
    }
  }
  const meta = await scrapeMetadata(novel.title, novel.author, chapters);
  if (!meta.description && meta.tags.length === 0 && !meta.cover_url) return { ok: false, error: '刮削无结果（起点未收录且未配置 DEEPSEEK_API_KEY）' };

  await applyScrapeResult(novelId, meta);
  const updated = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
  return { ok: true, title: updated.title, description: updated.description, tags: JSON.parse(updated.tags || '[]'), author: updated.author, cover_path: updated.cover_path, source: meta.source };
}

/**
 * 应用刮削结果到书籍（供上传/扫描导入的异步刮削调用）
 * 处理：简介/标签/作者更新 + 起点封面下载到本地
 */
async function applyScrapeResult(novelId, meta) {
  if (!meta || (!meta.description && !meta.tags.length && !meta.cover_url && !meta.author)) return;
  const db = require('./db').db;
  const fs = require('fs');
  const path = require('path');
  const { UPLOAD_DIR } = require('./db');
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
  if (!novel) return;

  let coverPath = novel.cover_path || '';
  if (meta.cover_url && meta.source === 'qidian') {
    try {
      const fname = `cover_${novelId}_${Date.now()}.jpg`;
      const resp = await fetch(meta.cover_url, { signal: AbortSignal.timeout(15000) });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
        coverPath = fname;
        if (novel.cover_path) { try { fs.unlinkSync(path.join(UPLOAD_DIR, novel.cover_path)); } catch (e) {} }
      }
    } catch (e) { /* 封面下载失败不阻塞 */ }
  }

  db.prepare('UPDATE novels SET description = ?, tags = ?, author = ?, cover_path = ? WHERE id = ?')
    .run(
      meta.description || novel.description || '',
      JSON.stringify(meta.tags.length ? meta.tags : JSON.parse(novel.tags || '[]')),
      meta.author || novel.author || '',
      coverPath,
      novelId
    );
}

module.exports = { scrapeMetadata, scrapeNovel, applyScrapeResult, extractSample, extractAuthorFromName, SCRAPE_ENABLED };
