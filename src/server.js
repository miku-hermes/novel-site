const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { db, UPLOAD_DIR, getSetting } = require('./db');
const {
  csrfProtection, csrfRequired, sqliteSessionStore,
  rateLimit,
} = require('./security');
const { router: authRouter, requireAuth, requireAdmin } = require('./routes/auth');
const novelsRouter = require('./routes/novels');
const readingRouter = require('./routes/reading');
const adminRouter = require('./routes/admin');

function createApp() {
  const app = express();
  const IS_PROD = process.env.NODE_ENV === 'production';
  const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

// 安全头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      // 注意：不能开 upgrade-insecure-requests，否则 http 内网/开发环境子资源全被升级到 https 导致加载失败
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false, // 开发环境禁用 HSTS，避免后续 http 访问被强制跳转
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(compression());
app.use(cookieParser());

// 会话
app.use(session({
  store: sqliteSessionStore,
  name: 'novelsite.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,        // 生产强制 https（1Panel 反代后需 https）
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  },
}));

// CSRF cookie 种子
app.use(csrfProtection);

// 全局 API 限流
app.use('/api', rateLimit({ max: 300, keyPrefix: 'api' }));

// 健康检查
app.get('/healthz', (req, res) => res.json({ ok: true, name: getSetting('site_name', '喵的书架') }));

// 静态资源：Vue SPA 构建产物（public-dist）
const DIST_DIR = path.join(__dirname, '..', 'public-dist');
const STATIC_DIR = DIST_DIR;
console.log(`[novel-site] serving static from: ${STATIC_DIR}`);
app.use(express.static(STATIC_DIR, { maxAge: IS_PROD ? '1h' : 0 }));
// SPA fallback：非 /api 路径全部回 index.html（强制不缓存，避免旧 bundle）
app.get(/^\/(?!api\/|healthz).*/, (req, res, next) => {
  if (!fs.existsSync(DIST_DIR)) return next();
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// 上传文件访问（封面等）
app.get('/api/files/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name); // 防目录穿越
  const fp = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在' });
  res.sendFile(fp);
});

// 站点名注入（供前端显示，无需登录）
app.get('/api/site', (req, res) => {
  res.json({ name: getSetting('site_name', '喵的书架'), allow_register: getSetting('allow_register', 'true') });
});

// 路由
app.use('/api/auth', authRouter);
app.use('/api', requireAuth, (req, res, next) => {
  // 以下写操作需要 CSRF 校验
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return csrfRequired(req, res, next);
  next();
});
app.use('/api/novels', novelsRouter);
app.use('/api/me', readingRouter);
app.use('/api/admin', adminRouter);

// 404 / 错误处理
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.name === 'MulterError') return res.status(400).json({ error: `上传失败: ${err.message}` });
  res.status(500).json({ error: '服务器内部错误' });
});

  return app;
}

// 直接运行时监听（测试时通过 createApp() 注入 supertest）
if (require.main === module) {
  const app = createApp();
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[novel-site] listening on :${PORT} (${process.env.NODE_ENV === 'production' ? 'production' : 'development'})`);
  });
}

module.exports = { createApp };
