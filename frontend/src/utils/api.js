// API 封装：自动带 CSRF、统一错误处理
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function request(method, url, body, isForm) {
  const headers = {};
  const csrf = getCookie('csrf_token');
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined && body !== null) {
    if (isForm) payload = body;
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  const resp = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  let data = null;
  try { data = await resp.json(); } catch (e) { /* 非 JSON */ }
  if (!resp.ok) {
    const err = new Error((data && data.error) || `请求失败 (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b, f) => request('POST', u, b, f),
  put: (u, b) => request('PUT', u, b),
  patch: (u, b) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
};

export function fmtWords(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1) + '万字';
  if (n >= 1000) return (n / 1000).toFixed(1) + '千字';
  return n + '字';
}

export function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  const diff = Date.now() - d;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + '分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + '小时前';
  if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + '天前';
  return d.toLocaleDateString('zh-CN');
}

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

let toastTimer = null;
export function toast(msg, isErr) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
