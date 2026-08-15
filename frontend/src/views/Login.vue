<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, toast } from '../utils/api';

const router = useRouter();
const view = ref('login'); // login | register | 2fa | setup | recovery
const siteName = ref('喵的书架');
const allowRegister = ref(true);
const needsSetup = ref(false);   // 无用户 → 引导模式

const loginForm = ref({ username: '', password: '' });
const regForm = ref({ username: '', password: '', password2: '' });
const twofaCode = ref('');
const setupCode = ref('');
const setupQr = ref('');
const setupSecret = ref('');
const recoveryCodes = ref([]);
const errMsg = ref('');
const pendingToken = ref(null);

onMounted(async () => {
  try {
    const s = await api.get('/api/site');
    siteName.value = s.name;
    allowRegister.value = s.allow_register !== 'false';
    needsSetup.value = !!s.needs_setup;
    // 引导模式：无任何用户 → 直接显示注册表单
    if (s.needs_setup && s.allow_register !== 'false') view.value = 'register';
  } catch (e) {}
  try { await api.get('/api/auth/me'); router.push('/home'); } catch (e) {}
});

async function doLogin() {
  errMsg.value = '';
  if (!loginForm.value.username || !loginForm.value.password) { errMsg.value = '请输入用户名和密码'; return; }
  try {
    const d = await api.post('/api/auth/login', loginForm.value);
    if (d.ok || !d.pending_token) {
      // 2FA 可选：未开启时直接登录成功
      router.push('/home');
      return;
    }
    pendingToken.value = d.pending_token;
    if (d.need_2fa_setup) { await loadSetupQr(); }
    else if (d.need_2fa) { view.value = '2fa'; }
  } catch (e) { errMsg.value = e.message; }
}

async function doVerify2fa() {
  errMsg.value = '';
  try {
    await api.post('/api/auth/verify-2fa', { pending_token: pendingToken.value, code: twofaCode.value.trim() });
    router.push('/home');
  } catch (e) { errMsg.value = e.message; }
}

async function loadSetupQr() {
  errMsg.value = '';
  try {
    const d = await api.post('/api/auth/setup-2fa', { pending_token: pendingToken.value });
    setupSecret.value = d.secret;
    setupQr.value = d.qr;
    view.value = 'setup';
  } catch (e) { errMsg.value = e.message; }
}

async function doEnable2fa() {
  errMsg.value = '';
  try {
    const d = await api.post('/api/auth/enable-2fa', { pending_token: pendingToken.value, code: setupCode.value.trim() });
    recoveryCodes.value = d.recovery_codes;
    view.value = 'recovery';
  } catch (e) { errMsg.value = e.message; }
}

function finishSetup() { router.push('/home'); }

async function doRegister() {
  errMsg.value = '';
  const f = regForm.value;
  if (!f.username || !f.password) { errMsg.value = '请填写用户名和密码'; return; }
  if (f.password !== f.password2) { errMsg.value = '两次密码不一致'; return; }
  try {
    const d = await api.post('/api/auth/register', { username: f.username, password: f.password });
    if (d.is_admin) toast('注册成功！你是本站管理员');
    // 引导模式：注册后自动登录（2FA 可选，未开启直接成功）
    try {
      const login = await api.post('/api/auth/login', { username: f.username, password: f.password });
      if (login.ok || !login.pending_token) { router.push('/home'); return; }
      pendingToken.value = login.pending_token;
      if (login.need_2fa_setup) { await loadSetupQr(); }
      else if (login.need_2fa) { view.value = '2fa'; }
    } catch (e2) {
      // 自动登录失败 → 回登录页
      view.value = 'login';
      loginForm.value.username = f.username;
      loginForm.value.password = '';
      errMsg.value = '注册成功，请登录';
      toast('注册成功，请登录');
    }
  } catch (e) { errMsg.value = e.message; }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <span class="auth-logo i-mdi-bookshelf"></span>
        <h1>{{ siteName }}</h1>
        <p v-if="needsSetup">欢迎！创建第一个账号开始使用</p>
        <p v-else>登录以继续阅读</p>
      </div>

      <!-- 引导横幅（无用户时） -->
      <div v-if="needsSetup" class="setup-banner">
        <span class="i-mdi-rocket-launch setup-banner-icon"></span>
        <div>
          <b>首次使用？创建你的账号</b>
          <p>第一个注册的账号自动成为本站管理员</p>
        </div>
      </div>

      <!-- 登录 -->
      <div v-if="view === 'login'">
        <div class="field">
          <label>用户名</label>
          <input v-model="loginForm.username" placeholder="2-20 位字母/数字/下划线/中文" autocomplete="username">
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="loginForm.password" type="password" placeholder="至少 8 位，含字母和数字" autocomplete="current-password" @keyup.enter="doLogin">
        </div>
        <button class="btn btn-primary w-full" @click="doLogin">登 录</button>
        <div v-if="allowRegister" class="auth-switch">还没有账号？<a href="#" @click.prevent="view = 'register'">注册</a></div>
        <div v-else class="auth-switch muted">本站已关闭注册</div>
      </div>

      <!-- 注册 -->
      <div v-else-if="view === 'register'">
        <p v-if="needsSetup" class="auth-hint setup-hint">✨ 你将创建本站的第一个账号，并成为管理员</p>
        <div class="field"><label>用户名</label><input v-model="regForm.username" placeholder="2-20 位字母/数字/下划线/中文"></div>
        <div class="field"><label>密码</label><input v-model="regForm.password" type="password" placeholder="至少 8 位，含字母和数字"></div>
        <div class="field"><label>确认密码</label><input v-model="regForm.password2" type="password"></div>
        <button class="btn btn-primary w-full" @click="doRegister">{{ needsSetup ? '创建并进入' : '注 册' }}</button>
        <div v-if="!needsSetup" class="auth-switch"><a href="#" @click.prevent="view = 'login'">← 返回登录</a></div>
      </div>

      <!-- 2FA 验证 -->
      <div v-else-if="view === '2fa'">
        <h2 class="auth-subtitle">两步验证</h2>
        <p class="auth-hint">请输入验证器 App 中的 6 位动态码（或备用恢复码）</p>
        <div class="field">
          <input v-model="twofaCode" placeholder="6 位动态码 / 恢复码" inputmode="numeric" @keyup.enter="doVerify2fa" autofocus>
        </div>
        <button class="btn btn-primary w-full" @click="doVerify2fa">验 证</button>
      </div>

      <!-- 2FA 绑定 -->
      <div v-else-if="view === 'setup'">
        <h2 class="auth-subtitle">绑定两步验证</h2>
        <p class="auth-hint">建议开启 2FA（可选），用验证器 App 扫描二维码</p>
        <div class="qr-box"><img :src="setupQr" alt="QR"></div>
        <p class="auth-hint">无法扫码时手动输入密钥：<b>{{ setupSecret }}</b></p>
        <div class="field">
          <label>输入 App 显示的 6 位动态码</label>
          <input v-model="setupCode" placeholder="6 位动态码" inputmode="numeric" @keyup.enter="doEnable2fa">
        </div>
        <button class="btn btn-primary w-full" @click="doEnable2fa">确认并继续</button>
      </div>

      <!-- 恢复码 -->
      <div v-else-if="view === 'recovery'">
        <h2 class="auth-subtitle">保存恢复码</h2>
        <p class="auth-hint">以下 10 个恢复码<b>只显示这一次</b>，请抄写保存。丢失 2FA 设备时可用来登录，每个码只能用一次。</p>
        <div class="recovery-grid">
          <span v-for="c in recoveryCodes" :key="c" class="recovery-item">{{ c }}</span>
        </div>
        <button class="btn btn-primary w-full" @click="finishSetup">我已保存，进入书架</button>
      </div>

      <div v-if="errMsg" class="auth-err">{{ errMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(160deg, #f6f5f2 0%, #efeaf8 100%); }
.auth-card {
  width: 100%; max-width: 420px; background: #fff; border-radius: 22px; padding: 40px 36px;
  box-shadow: 0 24px 70px rgba(31,35,51,.12), 0 0 0 1px rgba(124,92,191,.06);
  position: relative; overflow: hidden;
}
.auth-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #7c5cbf, #b388ff, #e1bee7); }
.auth-brand { text-align: center; margin-bottom: 26px; }
.auth-logo { font-size: 38px; display: block; margin-bottom: 8px; }
.auth-brand h1 { font-size: 24px; font-weight: 800; background: linear-gradient(135deg, #7c5cbf, #b388ff); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.auth-brand p { color: var(--ink-faint); font-size: 13px; margin-top: 4px; }
.auth-subtitle { font-size: 19px; font-weight: 700; text-align: center; }
.auth-hint { font-size: 12.5px; color: var(--ink-dim); text-align: center; margin: 10px 0 18px; line-height: 1.7; }
.auth-switch { text-align: center; font-size: 13px; color: var(--ink-dim); margin-top: 16px; }
.auth-err { color: var(--danger); font-size: 13px; margin-top: 12px; text-align: center; }
.qr-box { display: flex; justify-content: center; margin: 14px 0; }
.qr-box img { width: 190px; height: 190px; border-radius: 12px; background: #fff; padding: 6px; border: 1px solid var(--line); }
.recovery-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
.recovery-item { background: var(--brand-soft); border: 1px solid rgba(124,92,191,.18); border-radius: 8px; padding: 8px; text-align: center; font-family: ui-monospace, monospace; font-size: 13px; }
.w-full { width: 100%; }
.setup-banner {
  display: flex; align-items: center; gap: 12px; margin-bottom: 22px; padding: 14px 16px;
  background: linear-gradient(135deg, rgba(124,92,191,.08), rgba(179,136,255,.14));
  border: 1px solid rgba(124,92,191,.2); border-radius: 14px;
}
.setup-banner-icon { font-size: 26px; color: var(--brand); flex-shrink: 0; }
.setup-banner b { font-size: 14px; color: var(--brand); }
.setup-banner p { font-size: 12.5px; color: var(--ink-dim); margin-top: 2px; }
.setup-hint { color: var(--brand); font-weight: 600; }
/* 移动端适配 */
@media (max-width: 768px) {
  .auth-wrap { padding: 16px; }
  .auth-card { padding: 28px 20px; border-radius: 18px; }
  .auth-brand { margin-bottom: 20px; }
  .auth-logo { font-size: 32px; }
  .auth-brand h1 { font-size: 21px; }
  .qr-box img { width: 160px; height: 160px; }
}
</style>
