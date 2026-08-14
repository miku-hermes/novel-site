<script setup>
import { ref, onMounted } from 'vue';
import { api, toast } from '../utils/api';
import AppTopbar from '../components/AppTopbar.vue';

const me = ref(null);
const cp = ref({ old: '', next: '' });
const rcCode = ref('');
const rcResult = ref([]);
const d2Code = ref('');
const disabling = ref(false);
const en2faStep = ref(0);       // 0=未开始 1=已获取secret 2=已确认
const en2faQr = ref('');
const en2faSecret = ref('');
const en2faCode = ref('');
const enabling = ref(false);

onMounted(async () => {
  try { const d = await api.get('/api/auth/me'); me.value = d.user; } catch (e) {}
});

async function startEnable2FA() {
  en2faStep.value = 0;
  try {
    const d = await api.post('/api/auth/setup-2fa', {});
    en2faSecret.value = d.secret;
    en2faQr.value = d.qr;
    en2faStep.value = 1;
  } catch (e) { toast(e.message, true); }
}

async function confirmEnable2FA() {
  if (!en2faCode.value.trim()) { toast('请输入 6 位动态码', true); return; }
  enabling.value = true;
  try {
    const d = await api.post('/api/auth/enable-2fa', { code: en2faCode.value.trim() });
    toast('两步验证已开启');
    rcResult.value = d.recovery_codes || [];
    en2faStep.value = 0;
    en2faCode.value = '';
    const m = await api.get('/api/auth/me');
    me.value = m.user;
  } catch (e) { toast(e.message, true); }
  enabling.value = false;
}

async function changePassword() {
  try {
    await api.post('/api/auth/change-password', { old_password: cp.value.old, new_password: cp.value.next });
    toast('密码已修改，其他设备已下线');
    cp.value = { old: '', next: '' };
  } catch (e) { toast(e.message, true); }
}

async function regenRecovery() {
  rcResult.value = [];
  if (!rcCode.value.trim()) { toast('请输入 2FA 动态码', true); return; }
  try {
    const d = await api.post('/api/auth/regenerate-recovery', { code: rcCode.value.trim() });
    rcResult.value = d.recovery_codes;
    rcCode.value = '';
  } catch (e) { toast(e.message, true); }
}

async function disable2FA() {
  if (!d2Code.value.trim()) { toast('请输入 2FA 动态码', true); return; }
  if (!confirm('关闭两步验证后，登录将不再需要动态码。确认关闭？')) return;
  disabling.value = true;
  try {
    await api.post('/api/auth/disable-2fa', { code: d2Code.value.trim() });
    toast('已关闭两步验证');
    d2Code.value = '';
    const d = await api.get('/api/auth/me');
    me.value = d.user;
  } catch (e) { toast(e.message, true); }
  disabling.value = false;
}
</script>

<template>
  <div>
    <AppTopbar />
    <div class="settings-wrap">
      <div class="settings-card">
        <h2><span class="i-mdi-cog-outline mi"></span>账号设置</h2>

        <div v-if="me" class="info-rows">
          <div class="info-row"><span>用户名</span><b>{{ me.username }}</b></div>
          <div class="info-row"><span>角色</span><b>{{ me.role === 'admin' ? '管理员' : '普通用户' }}</b></div>
          <div class="info-row"><span>注册时间</span><b>{{ me.created_at ? me.created_at.replace('T',' ').slice(0,19) : '' }}</b></div>
          <div class="info-row"><span>2FA</span><b :style="{ color: me.twofa_enabled ? 'var(--ok)' : 'var(--danger)' }">{{ me.twofa_enabled ? '已开启 ✓' : '未开启' }}</b></div>
        </div>

        <hr class="divider">
        <h3>修改密码</h3>
        <div class="field"><label>原密码</label><input v-model="cp.old" type="password"></div>
        <div class="field"><label>新密码（≥8 位，含字母和数字）</label><input v-model="cp.next" type="password"></div>
        <button class="btn btn-primary" @click="changePassword">修改密码</button>

        <hr class="divider">
        <h3>恢复码</h3>
        <p class="hint">重新生成 10 个备用恢复码（需要输入当前 2FA 动态码确认）。旧恢复码立即作废。</p>
        <div class="field"><label>2FA 动态码</label><input v-model="rcCode" inputmode="numeric" placeholder="6 位动态码"></div>
        <button class="btn btn-primary" @click="regenRecovery">重新生成恢复码</button>
        <div v-if="rcResult.length" class="rc-grid">
          <span v-for="c in rcResult" :key="c" class="rc-item">{{ c }}</span>
        </div>

        <div v-if="me && !me.twofa_enabled">
          <hr class="divider">
          <h3>开启两步验证</h3>
          <p class="hint">开启后登录需要输入验证器 App 的 6 位动态码，账号更安全。</p>
          <template v-if="en2faStep === 0">
            <button class="btn btn-primary" @click="startEnable2FA">开始开启</button>
          </template>
          <template v-else>
            <div class="qr-box"><img :src="en2faQr" alt="QR"></div>
            <p class="hint">无法扫码时手动输入密钥：<b>{{ en2faSecret }}</b></p>
            <div class="field"><label>验证器动态码</label><input v-model="en2faCode" inputmode="numeric" placeholder="6 位动态码" @keyup.enter="confirmEnable2FA"></div>
            <button class="btn btn-primary" :disabled="enabling" @click="confirmEnable2FA">{{ enabling ? '开启中...' : '确认开启' }}</button>
          </template>
        </div>

        <div v-if="me && me.twofa_enabled">
          <hr class="divider">
          <h3>关闭两步验证</h3>
          <p class="hint">关闭后登录不再需要动态码，安全性会降低。需输入当前 2FA 动态码确认。</p>
          <div class="field"><label>2FA 动态码</label><input v-model="d2Code" inputmode="numeric" placeholder="6 位动态码"></div>
          <button class="btn btn-danger" :disabled="disabling" @click="disable2FA">{{ disabling ? '关闭中...' : '关闭两步验证' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-wrap { max-width: 620px; margin: 0 auto; padding: 40px 24px; }
.settings-card { background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 32px; box-shadow: var(--shadow-md); }
.settings-card h2 { font-size: 21px; font-weight: 800; margin-bottom: 20px; }
.settings-card h3 { font-size: 15px; color: var(--brand); margin-bottom: 14px; }
.info-rows { display: flex; flex-direction: column; gap: 10px; }
.info-row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; }
.info-row span { color: var(--ink-faint); }
.divider { border: none; border-top: 1px solid var(--line); margin: 26px 0; }
.hint { font-size: 12.5px; color: var(--ink-dim); line-height: 1.7; margin-bottom: 14px; }
.qr-box { display: flex; justify-content: center; margin: 14px 0; }
.qr-box img { width: 180px; height: 180px; border-radius: 12px; border: 1px solid var(--line); }
.rc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 16px; }
.rc-item { background: var(--brand-soft); border: 1px solid rgba(124,92,191,.18); border-radius: 8px; padding: 8px; text-align: center; font-family: ui-monospace, monospace; font-size: 13px; }
/* 移动端适配 */
@media (max-width: 768px) {
  .settings-wrap { padding: 20px 14px; }
  .settings-card { padding: 22px 18px; border-radius: 16px; }
  .settings-card h2 { font-size: 19px; }
  .divider { margin: 20px 0; }
  .rc-grid { grid-template-columns: 1fr; }
}
</style>
