// EPUB 解析：解压 zip -> container.xml -> OPF -> spine 顺序取 xhtml 转文本
// 用 fast-xml-parser 解析 XML（告别手写正则，支持命名空间/CDATA/实体）
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function htmlToText(html) {
  let t = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ');
  t = decodeEntities(t);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// 按任意命名空间取属性值：{"@_full-path": "..."} 或 {"@_xmlns:opf:full-path": "..."}
function attr(obj, key) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of Object.keys(obj)) {
    if (k.endsWith(':' + key) || k === '@_' + key) {
      const v = obj[k];
      return v != null ? String(v) : '';
    }
  }
  return '';
}

// 规范化条目名（去前导 /，统一大小写对比用）
function normName(n) {
  return String(n).replace(/^\/+/, '').replace(/\\/g, '/');
}

function parseEpub(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // 1. container.xml 定位 OPF（含命名空间兼容）
  const containerEntry = entries.find(e => /container\.xml$/i.test(e.entryName));
  if (!containerEntry) throw new Error('EPUB 缺少 container.xml');
  const containerXml = containerEntry.getData().toString('utf8');
  const container = xmlParser.parse(containerXml);
  const rootfile = container?.container?.rootfiles?.rootfile;
  const opfPath = rootfile && (attr(rootfile, 'full-path') || rootfile['@_full-path']) || '';
  if (!opfPath) throw new Error('EPUB container.xml 缺少 OPF 路径');

  const opfEntry = entries.find(e => normName(e.entryName) === normName(opfPath) || normName(e.entryName).endsWith('/' + normName(opfPath)));
  if (!opfEntry) throw new Error('EPUB 找不到 OPF 文件');
  const opfXml = opfEntry.getData().toString('utf8');
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. metadata: title / creator
  const opf = xmlParser.parse(opfXml);
  const meta = opf?.package?.metadata || {};
  let title = '';
  let creator = '';
  // metadata 可能是对象或数组
  for (const key of ['dc:title', 'title']) {
    const v = meta[key];
    if (v != null) { title = typeof v === 'object' ? (v['#text'] || '') : String(v); break; }
  }
  for (const key of ['dc:creator', 'creator']) {
    const v = meta[key];
    if (v != null) { creator = typeof v === 'object' ? (v['#text'] || '') : String(v); break; }
  }

  // 3. manifest: id -> href
  const manifest = {};
  const manifestNode = opf?.package?.manifest?.item;
  const items = Array.isArray(manifestNode) ? manifestNode : (manifestNode ? [manifestNode] : []);
  for (const it of items) {
    const id = attr(it, 'id') || it['@_id'] || '';
    const href = attr(it, 'href') || it['@_href'] || '';
    if (id && href) manifest[id] = href;
  }

  // 4. spine: idref 顺序
  const spineOrder = [];
  const spineNode = opf?.package?.spine?.itemref;
  const refs = Array.isArray(spineNode) ? spineNode : (spineNode ? [spineNode] : []);
  for (const ref of refs) {
    const idref = attr(ref, 'idref') || ref['@_idref'] || '';
    if (idref && manifest[idref]) spineOrder.push(manifest[idref]);
  }

  // 5. 按 spine 顺序读内容
  const chapters = [];
  for (const href of spineOrder) {
    let rel = String(href).split('#')[0];
    if (!rel) continue;
    if (!rel.startsWith('/')) rel = baseDir + rel;
    rel = rel.replace(/^\/+/, '');
    const entry = entries.find(e => normName(e.entryName) === normName(rel) || normName(e.entryName) === '/' + normName(rel));
    if (!entry) continue;
    const name = entry.entryName.split('/').pop().replace(/\.[^.]+$/, '');
    const rawHtml = entry.getData().toString('utf8');
    let text = htmlToText(rawHtml);
    if (!text) continue;
    // 尝试从 HTML 里提取 <title>
    const htitle = (rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    chapters.push({
      title: decodeEntities(htitle.trim()) || name.replace(/[_-]+/g, ' ') || `第 ${chapters.length + 1} 节`,
      content: text,
      idx: chapters.length,
      words_count: text.replace(/\s/g, '').length,
    });
  }

  if (chapters.length === 0) throw new Error('EPUB 中没有可读章节');
  return { title: decodeEntities(String(title).trim()) || '未命名', author: decodeEntities(String(creator).trim()), chapters };
}

module.exports = { parseEpub };
