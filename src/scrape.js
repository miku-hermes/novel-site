// 刮削模块：根据书名 + 正文片段自动生成元数据（简介/标签）
// 数据源：DeepSeek LLM API（可选，未配置 key 时静默跳过）
// 封面：渐变占位（前端已有），本模块不生成图片

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
 * 刮削：生成简介 + 标签
 * @param {string} title 书名
 * @param {string} author 已知作者（可为空）
 * @param {Array} chapters 章节数组（用于取正文样本）
 * @returns {Promise<{description, tags, author}>} 生成的元数据（失败返回空）
 */
async function scrapeMetadata(title, author, chapters) {
  if (!SCRAPE_ENABLED) return { description: '', tags: [], author: author || '' };
  const sample = extractSample(chapters);
  if (!sample) return { description: '', tags: [], author: author || '' };

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
    if (!resp.ok) return { description: '', tags: [], author: author || '' };
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      description: String(parsed.description || '').slice(0, 5000),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8).map(String).slice(0, 20) : [],
      author: author || '',
    };
  } catch (e) {
    return { description: '', tags: [], author: author || '' }; // 刮削失败不阻塞主流程
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
  if (!meta.description && meta.tags.length === 0) return { ok: false, error: '刮削无结果（可能未配置 DEEPSEEK_API_KEY）' };
  db.prepare('UPDATE novels SET description = ?, tags = ? WHERE id = ?')
    .run(meta.description || novel.description || '', JSON.stringify(meta.tags.length ? meta.tags : JSON.parse(novel.tags || '[]')), novelId);
  return { ok: true, title: novel.title, description: meta.description, tags: meta.tags };
}

module.exports = { scrapeMetadata, scrapeNovel, extractSample, extractAuthorFromName, SCRAPE_ENABLED };
