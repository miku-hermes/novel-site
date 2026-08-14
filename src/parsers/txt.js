// TXT 小说解析：Legado 式「规则库 + 自动探测」+ 启发式后处理
// 借鉴 gedoor/legado 的 textTocRule 设计：
//   1. 内置多套章节标题正则规则（第X章/数字/Chapter/特殊符号/卷等）
//   2. 自动探测：在文件内容上试跑每条规则，匹配数最多且间隔合理的规则胜出
//   3. 后处理：广告行过滤 + 短章节合并（正文句子误切自动修正）
// 注意：规则中的 [　\s] 需显式含全角空格 U+3000（JS 的 \s 不含）

// ---------- 规则库（源自 Legado txtTocRule.json，转 JS 正则） ----------
const RULES = [
  { name: '目录(去空白)', serial: 0, enable: true,
    rule: '(?<=[　\\s])(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|节(?!课)|卷|集(?![合和]))).{0,30}$' },
  { name: '目录', serial: 1, enable: true,
    rule: '^[ 　\\t]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|节(?!课)|卷|集(?![合和])|部(?![分赛游])|篇(?!张))).{0,30}$' },
  { name: '目录(匹配简介)', serial: 2, enable: false,
    rule: '(?<=[　\\s])(?:(?:内容|文章)?简介|文案|前言|序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|节(?!课)|卷|集(?![合和])|部(?![分赛游])|回(?![合来事去])|场(?![和合比电是])|篇(?!张))).{0,30}$' },
  { name: '目录(古典、轻小说备用)', serial: 3, enable: false,
    rule: '^[ 　\\t]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|节(?!课)|卷|集(?![合和])|部(?![分赛游])|回(?![合来事去])|场(?![和合比电是])|话|篇(?!张))).{0,30}$' },
  { name: '数字(纯数字标题)', serial: 4, enable: false,
    rule: '(?<=[　\\s])\\d+\\.?[ 　\\t]{0,4}$' },
  { name: '大写数字(纯数字标题)', serial: 5, enable: false,
    rule: '(?<=[　\\s])[零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}[ 　\\t]{0,4}$' },
  { name: '数字混合(纯数字标题)', serial: 6, enable: false,
    rule: '(?<=[　\\s])[零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟\\d]{1,12}[ 　\\t]{0,4}$' },
  { name: '数字 分隔符 标题名称', serial: 7, enable: true,
    rule: '^[ 　\\t]{0,4}\\d{1,5}[:：,.， 、_—\\-].{1,30}$' },
  { name: '大写数字 分隔符 标题名称', serial: 8, enable: true,
    rule: '^[ 　\\t]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|[零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章?)[ 、_—\\-].{1,30}$' },
  { name: '数字混合 分隔符 标题名称', serial: 9, enable: false,
    rule: '^[ 　\\t]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|[零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章?[ 、_—\\-]|\\d{1,5}章?[:：,.， 、_—\\-]).{0,30}$' },
  { name: '正文 标题/序号', serial: 10, enable: true,
    rule: '^[ 　\\t]{0,4}正文[ 　]{1,4}.{0,20}$' },
  { name: 'Chapter/Section/Part/Episode 序号 标题', serial: 11, enable: true,
    rule: '^[ 　\\t]{0,4}(?:[Cc]hapter|[Ss]ection|[Pp]art|ＰＡＲＴ|[Nn][oO][.、]|[Ee]pisode|(?:内容|文章)?简介|文案|前言|序章|楔子|正文(?!完|结)|终章|后记|尾声|番外)\\s{0,4}\\d{1,4}.{0,30}$' },
  { name: 'Chapter(去简介)', serial: 12, enable: false,
    rule: '^[ 　\\t]{0,4}(?:[Cc]hapter|[Ss]ection|[Pp]art|ＰＡＲＴ|[Nn][Oo]\\.|[Ee]pisode)\\s{0,4}\\d{1,4}.{0,30}$' },
  { name: '特殊符号 序号 标题', serial: 13, enable: true,
    rule: '(?<=[\\s　])[【〔〖「『〈［\\[](?:第|[Cc]hapter)[\\d零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,10}[章节].{0,20}$' },
  { name: '特殊符号 标题(成对)', serial: 14, enable: false,
    rule: '(?<=[\\s　]{0,4})(?:[\\[〈「『〖〔《（【\\(].{1,30}[\\)】）》〕〗』」〉\\]]?|(?:内容|文章)?简介|文案|前言|序章|楔子|正文(?!完|结)|终章|后记|尾声|番外)[ 　]{0,4}$' },
  { name: '特殊符号 标题(单个)', serial: 15, enable: true,
    rule: '(?<=[\\s　]{0,4})(?:[☆★✦✧].{1,30}|(?:内容|文章)?简介|文案|前言|序章|楔子|正文(?!完|结)|终章|后记|尾声|番外)[ 　]{0,4}$' },
  { name: '章/卷 序号 标题', serial: 16, enable: true,
    rule: '^[ \\t　]{0,4}(?:(?:内容|文章)?简介|文案|前言|序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|[卷章][\\d零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8})[ 　]{0,4}.{0,30}$' },
  { name: '顶格标题', serial: 17, enable: false,
    rule: '^\\S.{1,20}$' },
  { name: '双标题(前向)', serial: 18, enable: false,
    rule: '(?m)(?<=[ \\t　]{0,4})第[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章.{0,30}$(?=[\\s　]{0,8}第[\\d零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章)' },
  { name: '双标题(后向)', serial: 19, enable: false,
    rule: '(?m)(?<=[ \\t　]{0,4}第[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章.{0,30}$[\\s　]{0,8})第[\\d零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章.{0,30}$' },
  { name: '书名 括号 序号', serial: 20, enable: true,
    rule: '^[一-龥]{1,20}[ 　\\t]{0,4}[(（][\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}[)）][ 　\\t]{0,4}$' },
  { name: '书名 序号', serial: 21, enable: true,
    rule: '^[一-龥]{1,20}[ 　\\t]{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}[ 　\\t]{0,4}$' },
  { name: '特定字符 标题 特定符号', serial: 22, enable: false,
    rule: '(?<=\\={3,6}).{1,40}?(?=\\=)' },
  { name: '字数分割 分节阅读', serial: 23, enable: true,
    rule: '(?<=[ 　\\t]{0,4})(?:.{0,15}分[页节章段]阅读[-_ ]|第\\s{0,4}[\\d零一二两三四五六七八九十百千万]{1,6}\\s{0,4}[页节]).{0,30}$' },
  { name: '通用规则', serial: 24, enable: false,
    rule: '(?im)^.{0,6}(?:[引楔]子|正文(?!完|结)|[引序前]言|[序终]章|扉页|[上中下][部篇卷]|卷首语|后记|尾声|番外|={2,4}|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|节(?!课)|卷|页[、 　]|集(?![合和])|部(?![分是门落])|篇(?!张))).{0,40}$|^.{0,6}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟a-z]{1,8}[、. 　].{0,20}$' },
];

// 广告/水印/垃圾行特征（命中即丢弃）
const JUNK_PATTERNS = [
  /本章未完|未完待续|正在手打|手打更新|请稍后.*加载|内容加载中/,
  /最新网址|浏览器搜索|手机版地址|最快更新|无广告阅读|下载.*阅读/,
  /本站.*首发|首发于|请记住.*首发|看书网|笔趣阁.*首发/,
  /推荐票|月票|求订阅|求打赏|求追读|求推荐票/,
  /^【?推荐.*阅读】?$|^（?未完待续）?$/,
];

function isJunkLine(line) {
  return JUNK_PATTERNS.some(re => re.test(line));
}

function compileRule(rule) {
  try {
    return new RegExp(rule, 'gm');
  } catch (e) {
    return null;
  }
}

/**
 * 自动探测最合适的规则（Legado getTocRule 算法）
 * 在内容上试跑每条启用规则，统计"有效匹配数"（相邻匹配间隔 >1000 字符才算）
 * 匹配数最多的规则胜出；0 或 1 个匹配视为不可靠
 */
function detectRule(content) {
  // 行级剥离 emoji 前缀，逐行匹配（保证 ^ 锚定和 (?<=) 前视语义一致）
  const decorRe = /^[\s\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u20E3\u2605\u2606\u2660-\u2667\u2714\u2716\u2705\u274C\u2757\u2764\u2763\u2795\u2796\u27A1\u2B50\u303D\u00A9\u00AE\u2122\u3000]*/u;
  const lines = content.split('\n').map(l => l.replace(decorRe, '').trim());
  let bestPattern = null;
  let maxNum = 0;
  for (const r of RULES) {
    if (!r.enable) continue;
    const re = compileRule(r.rule);
    if (!re) continue;
    let num = 0;
    for (const line of lines) {
      if (!line) continue;
      re.lastIndex = 0;
      if (re.test(line)) num++;
    }
    // 匹配数 > 现有最优才替换（并列时保留先出现的、更基础的规则）
    if (num > maxNum) {
      maxNum = num;
      bestPattern = r;
    }
  }
  return { rule: bestPattern, matches: maxNum };
}

/**
 * 主解析入口
 * @param {string} content 原始文本
 * @param {string|null} customRule 用户自定义章节正则（可选，优先使用）
 */
function parseTxt(content, customRule) {
  const raw = String(content).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  const chapters = [];
  let current = null;
  let buf = [];

  // 选择规则：自定义 > 自动探测 > 无（整篇一章）
  let selectedRule = null;
  if (customRule) {
    selectedRule = { name: '自定义', rule: customRule };
  } else {
    const detect = detectRule(raw);
    // 阈值与文本规模挂钩：短文本（<20 行）匹配 >=1 即可，长文本需 >=2
    const lineCount = raw.split('\n').length;
    const minMatches = lineCount < 20 ? 1 : 2;
    if (detect.matches >= minMatches) selectedRule = detect.rule;
  }
  const pattern = selectedRule ? compileRule(selectedRule.rule) : null;

  // emoji/装饰符号前缀（🍋 第44章 / 🔑 十月番外 等）
  const DECOR_PREFIX = /^[\s\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u20E3\u2605\u2606\u2660-\u2667\u2714\u2716\u2705\u274C\u2757\u2764\u2763\u2795\u2796\u27A1\u2B50\u303D\u00A9\u00AE\u2122\u3000]*/u;

  const flush = () => {
    if (current) {
      current.content = buf.join('\n').trim();
      if (current.content) {
        current.words_count = current.content.replace(/\s/g, '').length;
        chapters.push(current);
      }
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (current) buf.push(line);
      continue;
    }
    // 先判断章节标题（标题里的"求月票/加更"等话术不算广告行）
    // 剥离 emoji 前缀后再匹配规则
    const stripped = t.replace(DECOR_PREFIX, '').trim();
    if (pattern && stripped && pattern.test(stripped)) {
      flush();
      current = { title: stripped.slice(0, 60), content: '', idx: chapters.length };
      buf = [];
      pattern.lastIndex = 0; // 重置（行级 test）
      continue;
    }
    if (isJunkLine(t)) continue;
    if (current) buf.push(line);
  }
  flush();

  // 后处理：短章节合并（误切的正文句子）
  const MIN_CHAPTER_WORDS = 300;
  if (chapters.length > 1) {
    const merged = [];
    const standardRe = /^(?:第[0-9零一二三四五六七八九十百千万两]+[章回卷集部篇]|卷\s*[0-9零一二三四五六七八九十百千万]+|[0-9]{1,4}[.、．]\s*\S+|序章|序言|前言|后记|尾声|楔子|番外|终章|上篇|中篇|下篇)/;
    for (const ch of chapters) {
      const isStandard = standardRe.test(ch.title.trim());
      if (merged.length > 0 && !isStandard && ch.words_count < MIN_CHAPTER_WORDS) {
        const prev = merged[merged.length - 1];
        prev.content = prev.content + '\n' + ch.title + '\n' + ch.content;
        prev.words_count = prev.content.replace(/\s/g, '').length;
      } else {
        merged.push({ ...ch });
      }
    }
    merged.forEach((c, i) => { c.idx = i; });
    return merged;
  }

  if (chapters.length === 0) {
    const text = raw.trim();
    if (text) {
      chapters.push({ title: '全文', content: text, idx: 0, words_count: text.replace(/\s/g, '').length });
    }
  }
  return chapters;
}

module.exports = { parseTxt, detectRule, RULES };
