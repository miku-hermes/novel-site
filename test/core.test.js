// 核心测试：认证 / 2FA / 权限越权（admin-only 写操作）/ 小说 CRUD / 书架 / 进度
// 运行：DATA_DIR=<临时目录> node --test test/*.test.js
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

// 关键：必须在 require app 之前设置 DATA_DIR，让 db.js 用到临时目录
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-test-'));
process.env.DATA_DIR = TMP;
process.env.SESSION_SECRET = 'test-secret-0123456789-0123456789-0123456789';

const { createApp } = require('../src/server');
const app = createApp();

const adminUser = { username: 'admin_test', password: 'Admin1234' };
const normalUser = { username: 'user_test', password: 'User1234' };
let adminCookie = '';
let userCookie = '';
let csrf = '';
let userCsrf = '';
let novelId = null;

function cookieJar(res) {
  const set = res.headers['set-cookie'] || [];
  return set.map(c => c.split(';')[0]).join('; ');
}

async function registerUser(u) {
  const res = await request(app).post('/api/auth/register').send({ username: u.username, password: u.password });
  return res;
}

async function login(u) {
  // 未绑定 2FA：登录返回 need_2fa_setup + pending_token
  const r1 = await request(app).post('/api/auth/login').send({ username: u.username, password: u.password });
  assert.strictEqual(r1.status, 200);
  assert.ok(r1.body.pending_token, '应返回 pending_token');
  const pending = r1.body.pending_token;
  // 绑定 2FA：setup-2fa 拿 secret（用 pending_token，不依赖 session/csrf）
  const r2 = await request(app).post('/api/auth/setup-2fa').send({ pending_token: pending });
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
  const { secret } = r2.body;
  // enable-2fa 确认绑定
  const speakeasy = require('speakeasy');
  const r3 = await request(app)
    .post('/api/auth/enable-2fa')
    .send({ pending_token: pending, code: speakeasy.totp({ secret, encoding: 'base32' }) });
  assert.strictEqual(r3.status, 200, JSON.stringify(r3.body));
  // 重新登录走 2FA 验证
  const r4 = await request(app).post('/api/auth/login').send({ username: u.username, password: u.password });
  assert.ok(r4.body.pending_token);
  const loginJar = cookieJar(r4); // 含 csrf_token
  const r5 = await request(app)
    .post('/api/auth/verify-2fa')
    .set('Cookie', loginJar)
    .set('x-csrf-token', (loginJar.match(/csrf_token=([^;]+)/) || [])[1] || '')
    .send({ pending_token: r4.body.pending_token, code: speakeasy.totp({ secret, encoding: 'base32' }) });
  assert.strictEqual(r5.status, 200, JSON.stringify(r5.body));
  const verifyJar = cookieJar(r5); // 含 novelsite.sid
  // 真实浏览器累积两个响应 cookie：login 的 csrf + verify 的 sid
  const finalCookie = [loginJar, verifyJar].filter(Boolean).join('; ');
  const csrfFinal = (loginJar.match(/csrf_token=([^;]+)/) || [])[1] || '';
  return { cookie: finalCookie, csrf: csrfFinal };
}

before(async () => {
  // 第一个注册用户自动 admin
  const r = await registerUser(adminUser);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.strictEqual(r.body.is_admin, true, '首个用户应为管理员');
  const a = await login(adminUser);
  adminCookie = a.cookie;
  csrf = a.csrf;
  const r2 = await registerUser(normalUser);
  assert.strictEqual(r2.status, 201);
  const u = await login(normalUser);
  userCookie = u.cookie;
  userCsrf = u.csrf;
});

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
});

describe('认证与 2FA', () => {
  test('未登录访问 /api/novels 返回 401', async () => {
    const res = await request(app).get('/api/novels');
    assert.strictEqual(res.status, 401);
  });
  test('错误密码登录 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin_test', password: 'Wrong1234' });
    assert.strictEqual(res.status, 401);
  });
  test('me 接口返回 twofa_enabled', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', adminCookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.twofa_enabled, true);
  });
});

describe('小说 CRUD', () => {
  test('管理员创建小说（无文件）', async () => {
    const res = await request(app)
      .post('/api/novels')
      .set('Cookie', adminCookie)
      .set('x-csrf-token', csrf)
      .send({ title: '测试小说', author: '测试作者', description: '简介', tags: ['测试'] });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    novelId = res.body.novel.id;
    assert.ok(novelId);
  });
  test('普通用户能读小说列表', async () => {
    const res = await request(app).get('/api/novels').set('Cookie', userCookie);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.items.length >= 1);
  });
  test('普通用户创建小说成功（上传保留 requireAuth）', async () => {
    const res = await request(app)
      .post('/api/novels')
      .set('Cookie', userCookie)
      .set('x-csrf-token', userCsrf)
      .send({ title: '普通用户的书' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  });
  test('越权：普通用户改小说 → 403', async () => {
    const res = await request(app)
      .put('/api/novels/' + novelId)
      .set('Cookie', userCookie)
      .set('x-csrf-token', csrf)
      .send({ title: '被篡改' });
    assert.strictEqual(res.status, 403, '普通用户不应能修改小说，实际: ' + res.status);
  });
  test('越权：普通用户删小说 → 403', async () => {
    const res = await request(app)
      .delete('/api/novels/' + novelId)
      .set('Cookie', userCookie)
      .set('x-csrf-token', csrf);
    assert.strictEqual(res.status, 403, '普通用户不应能删除小说');
  });
  test('越权：普通用户加章节 → 403', async () => {
    const res = await request(app)
      .post('/api/novels/chapters')
      .set('Cookie', userCookie)
      .set('x-csrf-token', csrf)
      .send({ novel_id: novelId, title: 'x', content: 'y' });
    assert.strictEqual(res.status, 403, '普通用户不应能新增章节');
  });
  test('管理员改小说成功', async () => {
    const res = await request(app)
      .put('/api/novels/' + novelId)
      .set('Cookie', adminCookie)
      .set('x-csrf-token', csrf)
      .send({ title: '测试小说v2', author: '作者v2' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.novel.title, '测试小说v2');
  });
  test('管理员删除普通用户的书成功', async () => {
    const list = await request(app).get('/api/novels?q=普通用户的书').set('Cookie', adminCookie);
    const target = list.body.items.find(i => i.title === '普通用户的书');
    assert.ok(target, '应找到普通用户的书');
    const res = await request(app)
      .delete('/api/novels/' + target.id)
      .set('Cookie', adminCookie)
      .set('x-csrf-token', csrf);
    assert.strictEqual(res.status, 200);
  });
});

describe('书架与进度', () => {
  test('加入书架 / 列表 / 移出', async () => {
    let res = await request(app)
      .post('/api/me/bookshelf/' + novelId)
      .set('Cookie', adminCookie)
      .set('x-csrf-token', csrf)
      .send({});
    assert.strictEqual(res.status, 200);
    res = await request(app).get('/api/me/bookshelf').set('Cookie', adminCookie);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.items.some(i => i.id === novelId));
    res = await request(app)
      .delete('/api/me/bookshelf/' + novelId)
      .set('Cookie', adminCookie)
      .set('x-csrf-token', csrf);
    assert.strictEqual(res.status, 200);
  });
  test('无 CSRF 的写操作 → 403', async () => {
    const res = await request(app)
      .put('/api/novels/' + novelId)
      .set('Cookie', adminCookie)
      .send({ title: '无csrf' });
    assert.strictEqual(res.status, 403, '缺少 CSRF 应被拒绝');
  });
});
