// 起点中文网刮削模块：通过 Camofox 反检测浏览器访问起点搜索，提取元数据
// 起点 WAF 会拦服务端 curl（HTTP 202 探测页），真实浏览器可通过
// Camofox REST API：http://172.18.0.5:9377（或 CAMOFOX_URL 环境变量）

const CAMOFOX_URL = process.env.CAMOFOX_URL || 'http://172.18.0.5:9377';
const USER_ID = 'novel-scraper';
const TIMEOUT_MS = 25000;

async function camofoxFetch(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(CAMOFOX_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 起点刮削：搜索书名，取第一个匹配结果
 * @param {string} title 书名
 * @returns {Promise<{ok, description, tags, author, cover_url, status, source}>}
 */
async function scrapeQidian(title) {
  const kw = encodeURIComponent(String(title || '').trim());
  if (!kw) return { ok: false, error: '缺少书名' };

  // 1. 创建标签页访问起点搜索
  const tab = await camofoxFetch('/tabs', {
    url: `https://www.qidian.com/search?kw=${kw}`,
    userId: USER_ID,
    sessionKey: 'qidian',
    width: 1280, height: 800,
  });
  if (!tab.tabId) return { ok: false, error: '无法打开起点（Camofox 不可用）' };
  const tabId = tab.tabId;

  try {
    // 2. 等待页面加载（WAF 探测需要几秒）
    await new Promise(r => setTimeout(r, 6000));

    // 3. 提取第一条结果
    const expr = `(() => {
      const items = document.querySelectorAll('.book-mid-info');
      if (!items.length) return JSON.stringify({ empty: true, body: document.body.innerText.slice(0, 200) });
      const el = items[0];
      const titleEl = el.querySelector('.book-info-title a');
      const authorEl = el.querySelector('.author .name');
      const catEls = el.querySelectorAll('.author a');
      const statusEl = el.querySelector('.author span');
      const introEl = el.querySelector('.intro');
      const imgEl = el.closest('li') ? el.closest('li').querySelector('img') : null;
      const bid = titleEl ? (titleEl.getAttribute('data-bid') || '') : '';
      return JSON.stringify({
        title: titleEl ? (titleEl.getAttribute('title') || titleEl.innerText || '').replace(/在线阅读$/, '') : '',
        href: titleEl ? titleEl.getAttribute('href') : '',
        author: authorEl ? authorEl.innerText.trim() : '',
        category: catEls.length > 1 ? catEls[1].innerText.trim() : '',
        status: statusEl ? statusEl.innerText.trim() : '',
        intro: introEl ? introEl.innerText.trim() : '',
        cover: imgEl ? imgEl.src : '',
        bid,
      });
    })()`;
    const ev = await camofoxFetch(`/tabs/${tabId}/evaluate`, { expression: expr, userId: USER_ID });
    let data;
    try { data = JSON.parse(ev.result || '{}'); } catch (e) { data = { empty: true }; }

    if (data.empty) return { ok: false, error: '起点搜索无结果（可能被 WAF 拦截）', raw: data.body };
    // 书名精确匹配校验（避免误匹配）
    const target = String(title).trim();
    const found = String(data.title || '').trim();
    if (found && found !== target) return { ok: false, error: `起点无精确匹配（最接近:《${found}》）` };

    // 4. 下载封面到本地（可选，取大图）
    let coverUrl = '';
    if (data.cover) {
      const big = data.cover.replace(/\/150$/, '/420');
      coverUrl = big;
    }

    return {
      ok: true,
      source: 'qidian',
      title: data.title,
      author: data.author,
      description: data.intro,
      category: data.category,
      status: data.status,
      tags: [data.category].filter(Boolean),
      cover_url: coverUrl,
      bid: data.bid,
    };
  } finally {
    // 关闭标签页
    try { await fetch(`${CAMOFOX_URL}/tabs/${tabId}`, { method: 'DELETE' }); } catch (e) {}
  }
}

module.exports = { scrapeQidian };
