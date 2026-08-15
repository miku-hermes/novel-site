<script setup>
import { ref, onMounted } from 'vue';
import { api, fmtWords, fmtTime, toast } from '../utils/api';
import { coverBg, coverChar } from '../utils/cover';
import AppTopbar from '../components/AppTopbar.vue';

const tab = ref('overview');
const stats = ref(null);
const users = ref([]);
const novels = ref([]);
const editOpen = ref(false);
const editForm = ref({ id: 0, title: '', author: '', description: '', tags: '', status: 'published' });
const coverInput = ref(null);
const backups = ref([]);
const logs = ref([]);
const settings = ref({ site_name: '', allow_register: true });
const restoreConfirm = ref('');
const restoreFile = ref(null);

async function loadOverview() {
  try { stats.value = await api.get('/api/admin/stats'); } catch (e) { toast(e.message, true); }
}
async function loadUsers() {
  try { const d = await api.get('/api/admin/users'); users.value = d.users; } catch (e) { toast(e.message, true); }
}
async function loadNovels() {
  try {
    const d = await api.get('/api/novels?sort=created&page=1&pageSize=500');
    novels.value = d.items;
  } catch (e) { toast(e.message, true); }
}
async function loadBackups() {
  try { const d = await api.get('/api/admin/backup'); backups.value = d.files; } catch (e) { toast(e.message, true); }
}
async function loadLogs() {
  try { const d = await api.get('/api/admin/logs?pageSize=60'); logs.value = d.logs; } catch (e) { toast(e.message, true); }
}
async function loadSettings() {
  try { settings.value = await api.get('/api/admin/settings'); } catch (e) {}
}

function switchTab(t) { tab.value = t; if (t === 'overview') loadOverview(); if (t === 'users') loadUsers(); if (t === 'novels') loadNovels(); if (t === 'backup') loadBackups(); if (t === 'logs') loadLogs(); if (t === 'settings') loadSettings(); }

// ---------- 小说管理 ----------
function openEdit(b) {
  editForm.value = {
    id: b.id, title: b.title || '', author: b.author || '', description: b.description || '',
    tags: (b.tags || []).join(', '), status: b.status || 'published',
  };
  editOpen.value = true;
}
async function saveEdit() {
  if (!editForm.value.title.trim()) { toast('书名不能为空', true); return; }
  try {
    await api.put('/api/novels/' + editForm.value.id, {
      title: editForm.value.title.trim(), author: editForm.value.author.trim(),
      description: editForm.value.description, tags: editForm.value.tags,
      status: editForm.value.status,
    });
    toast('已保存');
    editOpen.value = false;
    loadNovels();
  } catch (e) { toast(e.message, true); }
}
function pickCover(n) { coverInput.value = n; document.getElementById('admin-cover-file').click(); }
async function onCoverFile(ev) {
  const f = ev.target.files[0];
  if (!f || !coverInput.value) return;
  const fd = new FormData();
  fd.append('cover', f);
  try {
    await api.post('/api/novels/' + coverInput.value.id + '/cover', fd, true);
    toast('封面已更新');
    loadNovels();
  } catch (e) { toast(e.message, true); }
  coverInput.value = null;
  ev.target.value = '';
}
async function removeNovel(n) {
  if (!confirm(`确定删除《${n.title}》？所有章节将永久删除，不可恢复。`)) return;
  try { await api.del('/api/novels/' + n.id); toast('已删除'); loadNovels(); loadOverview(); } catch (e) { toast(e.message, true); }
}

async function toggleUser(u) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  if (!confirm(`确定${next === 'disabled' ? '禁用' : '启用'}用户 ${u.username}？`)) return;
  try { await api.patch('/api/admin/users/' + u.id, { status: next }); loadUsers(); toast('已更新'); } catch (e) { toast(e.message, true); }
}
async function toggleRole(u) {
  const next = u.role === 'admin' ? 'user' : 'admin';
  if (!confirm(`确定将 ${u.username} ${next === 'admin' ? '设为管理员' : '降为普通用户'}？`)) return;
  try { await api.patch('/api/admin/users/' + u.id, { role: next }); loadUsers(); toast('已更新'); } catch (e) { toast(e.message, true); }
}
async function resetPw(u) {
  const p = prompt(`为用户 ${u.username} 设置新密码（≥8 位，含字母和数字）`);
  if (!p) return;
  try { await api.post('/api/admin/users/' + u.id + '/reset-password', { new_password: p }); toast('密码已重置'); } catch (e) { toast(e.message, true); }
}

async function doBackup() {
  try { const d = await api.post('/api/admin/backup', {}); toast('备份完成：' + d.file); loadBackups(); } catch (e) { toast(e.message, true); }
}
async function deleteBackup(f) {
  if (!confirm(`删除备份 ${f}？`)) return;
  try { await api.del('/api/admin/backup/' + encodeURIComponent(f)); loadBackups(); } catch (e) { toast(e.message, true); }
}
function onRestoreFile(ev) { restoreFile.value = ev.target.files[0]; }
async function doRestore() {
  if (!restoreFile.value) { toast('请选择备份文件', true); return; }
  if (restoreConfirm.value !== 'RESTORE') { toast('确认口令错误（请输入 RESTORE）', true); return; }
  if (!confirm('即将用备份覆盖当前所有数据！确定继续？')) return;
  try {
    const fd = new FormData();
    fd.append('file', restoreFile.value);
    fd.append('confirm', 'RESTORE');
    const d = await api.post('/api/admin/restore', fd, true);
    toast(d.message || '恢复完成');
  } catch (e) { toast(e.message, true); }
}

async function saveSettings() {
  try {
    await api.put('/api/admin/settings', { site_name: settings.value.site_name, allow_register: settings.value.allow_register });
    toast('设置已保存');
  } catch (e) { toast(e.message, true); }
}

onMounted(() => { loadOverview(); loadUsers(); loadBackups(); loadLogs(); loadSettings(); });
</script>

<template>
  <div>
    <AppTopbar />
    <div class="admin-wrap">
      <div class="admin-tabs">
        <button v-for="t in [['overview','概览'],['novels','小说'],['users','用户'],['backup','备份'],['logs','日志'],['settings','设置']]" :key="t[0]"
          class="admin-tab" :class="{ active: tab === t[0] }" @click="switchTab(t[0])">{{ t[1] }}</button>
      </div>

      <!-- 概览 -->
      <div v-if="tab === 'overview'" class="stat-grid">
        <div v-for="(v, k) in stats ? [
          ['用户数', stats.users], ['小说数', stats.novels], ['章节数', stats.chapters],
          ['总字数', fmtWords(stats.words)], ['上传文件', stats.uploads], ['数据库', (stats.db_size/1024/1024).toFixed(1) + 'MB']
        ] : []" :key="k" class="stat-card">
          <div class="stat-label">{{ v[0] }}</div>
          <div class="stat-value">{{ v[1] }}</div>
        </div>
      </div>

      <!-- 小说管理 -->
      <div v-if="tab === 'novels'" class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <b>全部小说 ({{ novels.length }})</b>
          <span class="dim">编辑信息 / 更换封面 / 删除</span>
        </div>
        <table class="data-table">
          <thead><tr><th>ID</th><th>封面</th><th>书名</th><th>作者</th><th>章节</th><th>字数</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="n in novels" :key="n.id">
              <td>{{ n.id }}</td>
              <td>
                <div v-if="n.cover_url" class="admin-cover"><img :src="n.cover_url" alt="" loading="lazy"></div>
                <div v-else class="admin-cover admin-cover-fb" :style="coverBg(n.title, n.author)"><span>{{ coverChar(n.title) }}</span></div>
              </td>
              <td><b>{{ n.title }}</b></td>
              <td>{{ n.author || '佚名' }}</td>
              <td>{{ n.chapter_count }}</td>
              <td>{{ fmtWords(n.words_count) }}</td>
              <td>{{ n.status === 'draft' ? '草稿' : '已发布' }}</td>
              <td>
                <button class="btn btn-ghost btn-sm" @click="openEdit(n)"><span class="i-mdi-pencil-outline mi"></span>编辑</button>
                <button class="btn btn-ghost btn-sm" @click="pickCover(n)"><span class="i-mdi-image-outline mi"></span>换封面</button>
                <button class="btn btn-danger btn-sm" @click="removeNovel(n)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <input id="admin-cover-file" type="file" class="hidden-input" accept="image/jpeg,image/png,image/webp" @change="onCoverFile">
      </div>

      <!-- 用户 -->
      <div v-if="tab === 'users'" class="panel">
        <table class="data-table">
          <thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>2FA</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.id }}</td>
              <td><b>{{ u.username }}</b></td>
              <td>{{ u.role === 'admin' ? '管理员' : '用户' }}</td>
              <td>{{ u.twofa_enabled ? '✓' : '✗' }}</td>
              <td :style="{ color: u.status === 'disabled' ? 'var(--danger)' : 'var(--ok)' }">{{ u.status === 'disabled' ? '禁用' : '正常' }}</td>
              <td class="dim">{{ fmtTime(u.created_at) }}</td>
              <td>
                <button class="btn btn-ghost btn-sm" @click="toggleUser(u)">{{ u.status === 'active' ? '禁用' : '启用' }}</button>
                <button v-if="u.role === 'user'" class="btn btn-ghost btn-sm" @click="toggleRole(u)">设管理员</button>
                <button class="btn btn-ghost btn-sm" @click="resetPw(u)">重置密码</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 备份 -->
      <div v-if="tab === 'backup'" class="panel">
        <div class="backup-actions">
          <button class="btn btn-primary" @click="doBackup">立即创建备份</button>
          <span class="dim">备份 = 数据库 + 上传文件，AES-256-GCM 加密</span>
        </div>
        <div class="restore-box">
          <h3>恢复备份（危险操作）</h3>
          <p class="hint">上传加密备份文件恢复数据。恢复后服务会自动重启，当前数据会被替换！</p>
          <div class="field"><input type="file" accept=".zip" @change="onRestoreFile"></div>
          <div class="field"><label>确认口令：输入 RESTORE 以继续</label><input v-model="restoreConfirm" placeholder="RESTORE"></div>
          <button class="btn btn-danger" @click="doRestore">恢复备份</button>
        </div>
        <table class="data-table">
          <thead><tr><th>文件名</th><th>大小</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="f in backups" :key="f.file">
              <td>{{ f.file }}</td>
              <td>{{ (f.size/1024/1024).toFixed(2) }}MB</td>
              <td class="dim">{{ f.mtime ? new Date(f.mtime).toLocaleString('zh-CN') : '' }}</td>
              <td>
                <a :href="'/api/admin/backup/download/' + encodeURIComponent(f.file)" download class="btn btn-ghost btn-sm">下载</a>
                <button class="btn btn-ghost btn-sm" @click="deleteBackup(f.file)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 日志 -->
      <div v-if="tab === 'logs'" class="panel">
        <table class="data-table">
          <thead><tr><th>时间</th><th>用户</th><th>动作</th><th>详情</th><th>IP</th></tr></thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td class="dim">{{ fmtTime(l.created_at) }}</td>
              <td>{{ l.username || '—' }}</td>
              <td>{{ l.action }}</td>
              <td class="dim log-detail">{{ l.detail }}</td>
              <td class="dim">{{ l.ip }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 设置 -->
      <div v-if="tab === 'settings'" class="panel narrow">
        <div class="field"><label>站点名称</label><input v-model="settings.site_name"></div>
        <div class="field checkbox"><label><input type="checkbox" v-model="settings.allow_register"> 允许新用户注册</label></div>
        <button class="btn btn-primary" @click="saveSettings">保存设置</button>
      </div>

      <!-- 编辑弹窗 -->
      <div v-if="editOpen" class="modal-mask" @click.self="editOpen = false">
        <div class="modal-panel">
          <h3 style="margin-bottom:16px"><span class="i-mdi-pencil-outline mi"></span>编辑小说</h3>
          <div class="field"><label>书名</label><input v-model="editForm.title"></div>
          <div class="field"><label>作者</label><input v-model="editForm.author"></div>
          <div class="field"><label>简介</label><textarea v-model="editForm.description"></textarea></div>
          <div class="field"><label>标签（逗号分隔）</label><input v-model="editForm.tags" placeholder="如：玄幻, 完结"></div>
          <div class="field">
            <label>状态</label>
            <select v-model="editForm.status"><option value="published">已发布</option><option value="draft">草稿</option></select>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
            <button class="btn btn-ghost" @click="editOpen = false">取消</button>
            <button class="btn btn-primary" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-wrap { max-width: 1080px; margin: 0 auto; padding: 26px 24px 70px; }
.admin-tabs { display: flex; gap: 6px; margin-bottom: 22px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
.admin-tab {
  background: none; border: none; font-size: 14px; font-family: inherit; cursor: pointer;
  color: var(--ink-dim); padding: 8px 16px; border-radius: 9px; transition: all .18s;
}
.admin-tab:hover { color: var(--ink); background: rgba(124,92,191,.06); }
.admin-tab.active { color: var(--brand); background: var(--brand-soft); font-weight: 600; }
.panel { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 22px; box-shadow: var(--shadow-sm); }
.panel.narrow { max-width: 520px; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
.stat-card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 20px; box-shadow: var(--shadow-sm); }
.stat-label { font-size: 12.5px; color: var(--ink-faint); }
.stat-value { font-size: 26px; font-weight: 800; margin-top: 6px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { text-align: left; padding: 11px 12px; border-bottom: 1px solid var(--line); }
.data-table th { color: var(--ink-faint); font-size: 12px; font-weight: 600; }
.data-table tr:hover td { background: #faf9f6; }
.dim { color: var(--ink-faint); font-size: 12px; }
.log-detail { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.backup-actions { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.restore-box { border: 1px dashed var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; background: #faf9f6; }
.restore-box h3 { font-size: 15px; color: var(--danger); margin-bottom: 8px; }
.hint { font-size: 12.5px; color: var(--ink-dim); line-height: 1.7; }
.checkbox label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink); }
.checkbox input { width: auto; }
.admin-cover { width: 34px; height: 46px; border-radius: 5px; overflow: hidden; background: var(--brand-soft); }
.admin-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.admin-cover-fb { display: flex; align-items: center; justify-content: center; }
.admin-cover-fb span { color: #fff; font-size: 16px; font-weight: 800; text-shadow: 0 1px 6px rgba(0,0,0,.45); }
/* 移动端适配 */
@media (max-width: 768px) {
  .admin-wrap { padding: 18px 14px 60px; }
  .admin-tabs { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 8px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .admin-tabs::-webkit-scrollbar { display: none; }
  .admin-tab { padding: 8px 13px; font-size: 13px; white-space: nowrap; }
  .panel { padding: 16px 14px; border-radius: 14px; }
  .stat-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
  .stat-card { padding: 14px; }
  .stat-value { font-size: 22px; }
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .data-table { display: block; overflow-x: auto; min-width: 0; font-size: 12px; white-space: nowrap; }
  .data-table table { min-width: 520px; }
  .backup-actions { flex-wrap: wrap; gap: 10px; }
  .restore-box { padding: 14px; }
}
</style>
