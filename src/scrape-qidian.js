// 起点刮削模块：通过自建 scraper-api 服务（内部用 Camofox 爬起点）
// 解耦：书城不再直接依赖 Camofox，只依赖 scraper-api 的 HTTP 接口
// scraper-api 自带缓存（24h），重复刮削不重复爬

const SCRAPER_API_URL = process.env.SCRAPER_API_URL || 'http://172.18.0.10:3200';
const TIMEOUT_MS = 35000;

async function scraperFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(SCRAPER_API_URL + path, { signal: controller.signal });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { clearTimeout(timer); }
}

/**
 * 起点刮削：搜索书名，取第一个精确匹配结果
 * @param {string} title 书名
 * @returns {Promise<{ok, description, tags, author, cover_url, status, source}>}
 */
async function scrapeQidian(title) {
  const target = String(title || '').trim();
  if (!target) return { ok: false, error: '缺少书名' };

  const d = await scraperFetch('/api/detail?title=' + encodeURIComponent(target));
  if (!d.ok) return { ok: false, error: d.error || '刮削服务不可用' };

  return {
    ok: true,
    source: 'qidian',
    title: d.title,
    author: d.author,
    description: d.intro,
    category: d.category,
    status: d.status,
    tags: (d.tags || []).filter(Boolean),
    cover_url: d.cover_url || '',  // 已由 scraper-api 转为 /300 大图
    bid: d.bid,
  };
}

module.exports = { scrapeQidian };
