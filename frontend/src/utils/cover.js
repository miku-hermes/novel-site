// 渐变封面生成器 v2：深色书籍质感（解决浅色底白字看不清的问题）
// 设计：深底渐变 + 顶部高光 + 底部渐隐 + 书名竖排感

const PALETTES = [
  ['#3d2b5c', '#7c5cbf', '#b388ff'], // 紫
  ['#1e3a5c', '#3d6a94', '#7fb2d9'], // 蓝
  ['#38214d', '#6a3f94', '#c58ee8'], // 葡萄
  ['#24403a', '#3f7467', '#8ec4b2'], // 绿
  ['#4a2436', '#8a3f5c', '#e08aaa'], // 玫红
  ['#2e2b4d', '#5c5794', '#a9a3d9'], // 灰紫
  ['#3f2c1a', '#7a5632', '#c9a06b'], // 棕
  ['#1c2f4a', '#3d5f94', '#8fb8e0'], // 靛蓝
  ['#47202a', '#8a3d52', '#e09aa8'], // 红棕
  ['#1f3f40', '#3d7072', '#8fc7c8'], // 青
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// 返回 cover 的背景 CSS（深色渐变+高光），无图片时用
export function coverBg(title = '', author = '') {
  const seed = hashStr(title + '|' + author);
  const [c1, c2, c3] = PALETTES[seed % PALETTES.length];
  const angle = [135, 145, 120, 160, 130][Math.floor(seed / PALETTES.length) % 5];
  const hx = 15 + (seed >> 5) % 70;
  const hy = 10 + (seed >> 9) % 60;

  return {
    background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 55%, ${c3} 130%)`,
    backgroundImage: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 55%, ${c3} 130%), radial-gradient(70% 50% at ${hx}% ${hy}%, rgba(255,255,255,0.22), transparent 70%)`,
  };
}

export function coverChar(title = '') {
  return (title || '书')[0];
}
