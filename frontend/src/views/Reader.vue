<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, fmtWords } from '../utils/api';

const route = useRoute();
const router = useRouter();
const novelId = computed(() => parseInt(route.params.id, 10));
const novel = ref(null);
const chapters = ref([]);
const currentIdx = ref(-1);
const content = ref('');
const fontSize = ref(parseInt(localStorage.getItem('reader-font') || '18', 10));
const theme = ref(localStorage.getItem('reader-theme') || 'light');
const drawerOpen = ref(false);

const themes = [
  { key: 'light', name: '白底' },
  { key: 'sepia', name: '护眼' },
  { key: 'dark', name: '夜间' },
];

const bodyClass = computed(() => 'reader-theme-' + theme.value);

onMounted(async () => {
  try {
    const [d1, d2] = await Promise.all([
      api.get('/api/novels/' + novelId.value),
      api.get('/api/novels/' + novelId.value + '/chapters'),
    ]);
    novel.value = d1.novel;
    chapters.value = d2.chapters;
    document.title = novel.value.title + ' · 阅读';
    let idx = 0;
    if (route.query.ch) {
      const found = chapters.value.findIndex(c => c.id === parseInt(route.query.ch, 10));
      if (found >= 0) idx = found;
    } else if (novel.value.last_chapter_id) {
      const found = chapters.value.findIndex(c => c.id === novel.value.last_chapter_id);
      if (found >= 0) idx = found;
    }
    loadChapter(idx);
  } catch (e) { content.value = e.message; }
});

async function loadChapter(idx) {
  if (idx < 0 || idx >= chapters.value.length) return;
  currentIdx.value = idx;
  const ch = chapters.value[idx];
  try {
    const d = await api.get(`/api/novels/${novelId.value}/chapters/${ch.id}`);
    content.value = d.chapter.content || '（本章为空）';
    api.put('/api/me/progress/' + novelId.value, { chapter_id: ch.id, progress: 0 }).catch(() => {});
    router.replace({ path: '/read/' + novelId.value, query: { ch: ch.id } });
    window.scrollTo({ top: 0 });
  } catch (e) { content.value = e.message; }
}

function goChapter(delta) { loadChapter(currentIdx.value + delta); }
function jumpChapter(i) { drawerOpen.value = false; loadChapter(i); }
function toggleDrawer() { drawerOpen.value = !drawerOpen.value; }
function setFont(d) { fontSize.value = Math.min(28, Math.max(14, fontSize.value + d)); localStorage.setItem('reader-font', String(fontSize.value)); }
function setTheme(t) { theme.value = t; localStorage.setItem('reader-theme', t); }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') drawerOpen.value = false;
  if (e.key === 'ArrowLeft' && currentIdx.value > 0) loadChapter(currentIdx.value - 1);
  if (e.key === 'ArrowRight' && currentIdx.value < chapters.value.length - 1) loadChapter(currentIdx.value + 1);
});
</script>

<template>
  <div :class="bodyClass" class="reader-root">
    <div class="reader-top">
      <button class="back-btn" @click="router.push('/book/' + novelId)">← 书城</button>
      <div class="reader-heading">
        <div class="book-name">{{ novel ? novel.title : '' }}</div>
        <div class="ch-name">{{ chapters[currentIdx] ? chapters[currentIdx].title : '' }}</div>
      </div>
      <button class="toc-btn" @click="toggleDrawer"><span class="i-mdi-format-list-bulleted mi"></span>目录</button>
    </div>

    <div class="reader-settings">
      <span class="lbl">字号</span>
      <button @click="setFont(-1)">A-</button>
      <button @click="setFont(1)">A+</button>
      <span class="lbl sep">主题</span>
      <button v-for="t in themes" :key="t.key" :class="{ active: theme === t.key }" @click="setTheme(t.key)">{{ t.name }}</button>
      <span class="spacer"></span>
      <span class="idx">{{ currentIdx + 1 }} / {{ chapters.length }}</span>
    </div>

    <div class="reader-body" :style="{ fontSize: fontSize + 'px' }">{{ content }}</div>

    <div class="reader-nav">
      <button :disabled="currentIdx <= 0" @click="goChapter(-1)">← 上一章</button>
      <button @click="toggleDrawer">目录</button>
      <button :disabled="currentIdx >= chapters.length - 1" @click="goChapter(1)">下一章 →</button>
    </div>

    <!-- 目录侧滑 -->
    <div class="drawer-mask" :class="{ open: drawerOpen }" @click="toggleDrawer"></div>
    <aside class="toc-drawer" :class="{ open: drawerOpen }">
      <div class="toc-head">
        <b>目录 · {{ novel ? novel.title : '' }}</b>
        <button class="toc-close" @click="toggleDrawer">×</button>
      </div>
      <div class="toc-body">
        <div
          v-for="(c, i) in chapters" :key="c.id"
          class="toc-item" :class="{ active: i === currentIdx }"
          @click="jumpChapter(i)"
        >
          <span class="toc-no">{{ String(i + 1).padStart(3, '0') }}</span>
          <span class="toc-title">{{ c.title }}</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<style>
.reader-root { min-height: 100vh; --rb: #f6f5f2; --rt: #2b2f3e; background: var(--rb); color: var(--rt); transition: background .2s, color .2s; }
.reader-root.reader-theme-sepia { --rb: #f2ead6; --rt: #4a3f2a; }
.reader-root.reader-theme-dark { --rb: #12141c; --rt: #c9cdd8; }
.reader-root.reader-theme-dark .toc-drawer, .reader-root.reader-theme-dark .reader-settings { background: #1a1d29; border-color: #2a2e3d; color: #c9cdd8; }
.reader-root.reader-theme-dark .toc-item:hover, .reader-root.reader-theme-dark .toc-item.active { background: rgba(124,92,191,.2); }
.reader-root.reader-theme-dark .reader-nav button, .reader-root.reader-theme-dark .back-btn, .reader-root.reader-theme-dark .toc-btn { background: #1a1d29; color: #c9cdd8; border-color: #2a2e3d; }
.reader-root.reader-theme-dark .toc-close { color: #c9cdd8; }
</style>

<style scoped>
.reader-top { max-width: 780px; margin: 0 auto; display: flex; align-items: center; gap: 14px; padding: 30px 24px 0; }
.back-btn, .toc-btn {
  background: #fff; border: 1px solid var(--line); border-radius: 9px; padding: 8px 14px;
  font-size: 13px; cursor: pointer; color: var(--ink-dim); transition: all .18s; font-family: inherit; box-shadow: var(--shadow-sm);
}
.back-btn:hover, .toc-btn:hover { border-color: var(--brand-light); color: var(--brand); }
.reader-heading { flex: 1; min-width: 0; }
.book-name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-name { font-size: 13px; color: var(--ink-faint); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reader-settings {
  max-width: 780px; margin: 20px auto 0; display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 8px 14px; box-shadow: var(--shadow-sm);
}
.reader-settings button {
  border: 1px solid var(--line); background: transparent; border-radius: 7px; padding: 4px 11px;
  font-size: 12px; cursor: pointer; color: var(--ink-dim); transition: all .15s; font-family: inherit;
}
.reader-settings button:hover { border-color: var(--brand-light); color: var(--brand); }
.reader-settings button.active { border-color: var(--brand); color: var(--brand); background: var(--brand-soft); }
.reader-settings .lbl { font-size: 12px; color: var(--ink-faint); }
.reader-settings .sep { margin-left: 8px; }
.spacer { flex: 1; }
.idx { font-size: 12px; color: var(--ink-faint); }
.reader-body {
  max-width: 720px; margin: 0 auto; padding: 38px 24px 30px;
  line-height: 2.1; letter-spacing: .02em; text-align: justify;
  white-space: pre-wrap; word-break: break-word;
}
.reader-nav { max-width: 720px; margin: 0 auto; padding: 30px 24px 80px; display: flex; justify-content: space-between; gap: 12px; }
.reader-nav button {
  background: #fff; border: 1px solid var(--line); border-radius: 11px; padding: 10px 20px;
  font-size: 14px; cursor: pointer; transition: all .18s; font-family: inherit; box-shadow: var(--shadow-sm); color: var(--ink);
}
.reader-nav button:hover:not(:disabled) { border-color: var(--brand-light); color: var(--brand); transform: translateY(-1px); }
.reader-nav button:disabled { opacity: .35; cursor: not-allowed; }
.drawer-mask { position: fixed; inset: 0; background: rgba(31,35,51,.3); z-index: 90; opacity: 0; pointer-events: none; transition: opacity .25s; }
.drawer-mask.open { opacity: 1; pointer-events: auto; }
.toc-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 320px; max-width: 85vw; z-index: 95;
  background: #fff; border-left: 1px solid var(--line);
  transform: translateX(100%); transition: transform .28s cubic-bezier(.2,.8,.3,1);
  display: flex; flex-direction: column; box-shadow: -18px 0 44px rgba(31,35,51,.12);
}
.toc-drawer.open { transform: translateX(0); }
.toc-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--line); }
.toc-head b { font-size: 15px; }
.toc-close { background: none; border: none; font-size: 22px; color: var(--ink-dim); cursor: pointer; line-height: 1; }
.toc-body { flex: 1; overflow-y: auto; padding: 10px; }
.toc-item { display: flex; gap: 10px; padding: 12px 14px; border-radius: 9px; cursor: pointer; font-size: 13.5px; color: var(--ink); transition: background .15s; }
.toc-item:hover { background: rgba(124,92,191,.07); }
.toc-item.active { background: rgba(124,92,191,.12); color: var(--brand); font-weight: 600; }
.toc-no { color: var(--ink-faint); font-size: 11px; font-family: ui-monospace, monospace; }
.toc-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ---------- 移动端适配 ---------- */
@media (max-width: 768px) {
  .reader-top { padding: 18px 14px 0; gap: 10px; }
  .reader-top .back-btn, .reader-top .toc-btn { padding: 7px 11px; font-size: 12px; }
  .reader-settings { margin: 14px 14px 0; padding: 7px 10px; }
  .reader-settings .lbl { display: none; }
  .reader-body { padding: 24px 18px 20px; font-size: 17px; line-height: 2; }
  .reader-nav { padding: 20px 18px 60px; }
  .reader-nav button { padding: 9px 14px; font-size: 13px; }
  .toc-drawer { width: 85vw; }
}
</style>
