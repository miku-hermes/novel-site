<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, fmtWords, toast } from '../utils/api';
import AppTopbar from '../components/AppTopbar.vue';
import BookCover from '../components/BookCover.vue';

const route = useRoute();
const router = useRouter();
const novel = ref(null);
const chapters = ref([]);
const showAllChapters = ref(false);
const CHAPTER_PREVIEW = 50;
const visibleChapters = computed(() => showAllChapters.value ? chapters.value : chapters.value.slice(0, CHAPTER_PREVIEW));
const loading = ref(true);
const downloadOpen = ref(false);

const novelId = computed(() => parseInt(route.params.id, 10));

onMounted(async () => {
  try {
    const d = await api.get('/api/novels/' + novelId.value);
    novel.value = d.novel;
    document.title = d.novel.title + ' · 喵的书架';
    const c = await api.get(`/api/novels/${novelId.value}/chapters`);
    chapters.value = c.chapters;
  } catch (e) {
    toast(e.message, true);
  }
  loading.value = false;
});

function openReader(chId) {
  const target = chId || novel.value.last_chapter_id;
  router.push({ path: '/read/' + novelId.value, query: target ? { ch: target } : {} });
}

async function toggleShelf() {
  try {
    if (novel.value.in_shelf) { await api.del('/api/me/bookshelf/' + novelId.value); novel.value.in_shelf = false; toast('已移出书架'); }
    else { await api.post('/api/me/bookshelf/' + novelId.value, {}); novel.value.in_shelf = true; toast('已加入书架'); }
  } catch (e) { toast(e.message, true); }
}

function downloadBook(format) {
  downloadOpen.value = false;
  const url = `/api/novels/${novelId.value}/download?format=${format}`;
  // 方案1：直接 window.open（同源，带 cookie 鉴权；兼容性最好）
  const w = window.open(url, '_blank');
  if (w) {
    // 如果浏览器拦截了 popup，回退到临时链接
    try { w.focus(); } catch (e) {}
    setTimeout(() => {
      if (w && w.closed) {
        const a = document.createElement('a');
        a.href = url;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }, 300);
    toast('下载开始');
    return;
  }
  // 方案2：fetch blob（window.open 被拦截时的兜底）
  fetch(url).then(r => {
    if (!r.ok) throw new Error('下载失败');
    return r.blob();
  }).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${novel.value.title}.${format === 'epub' ? 'epub' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    toast('下载开始');
  }).catch(e => toast(e.message, true));
}
</script>

<template>
  <div>
    <AppTopbar />
    <div class="detail-page">
      <div v-if="loading" class="empty-state">加载中...</div>

      <template v-else-if="novel">
        <!-- Hero -->
        <div class="detail-hero">
          <div class="hero-cover">
            <BookCover :title="novel.title" :cover-url="novel.cover_url" :author="novel.author" size="lg" />
          </div>
          <div class="hero-info">
            <h1>{{ novel.title }}</h1>
            <div class="byline">{{ novel.author || '佚名' }}</div>
            <div class="tags" v-if="novel.tags.length">
              <span v-for="t in novel.tags" :key="t" class="pill">{{ t }}</span>
            </div>
            <div class="stats">
              <div class="stat"><b>{{ fmtWords(novel.words_count) }}</b><span>总字数</span></div>
              <div class="stat"><b>{{ novel.chapter_count }}</b><span>章节</span></div>
              <div class="stat"><b>{{ novel.status === 'draft' ? '草稿' : '已发布' }}</b><span>状态</span></div>
            </div>
            <div class="actions">
              <button class="btn btn-primary" @click="openReader()">{{ novel.last_chapter_id ? '继续阅读' : '开始阅读' }}</button>
              <button class="btn btn-ghost" @click="toggleShelf"><span v-if="!novel.in_shelf" class="i-mdi-bookmark-plus-outline mi"></span><span v-else class="i-mdi-bookmark-check mi"></span>{{ novel.in_shelf ? '在书架' : '加入书架' }}</button>
              <div class="dl-wrap">
                <button class="btn btn-ghost" @click="downloadOpen = !downloadOpen"><span class="i-mdi-download-outline mi"></span>下载 <span class="dl-caret">▾</span></button>
                <div v-if="downloadOpen" class="dl-menu">
                  <button class="dl-item" @click="downloadBook('txt')"><span class="i-mdi-file-document-outline mi"></span>TXT 文本</button>
                  <button class="dl-item" @click="downloadBook('epub')"><span class="i-mdi-book-open-variant mi"></span>EPUB 电子书</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 简介 -->
        <div class="desc-card">
          <h3>简介</h3>
          <p>{{ novel.description || '（暂无简介）' }}</p>
        </div>

        <!-- 目录 -->
        <div class="section-title">目录 <span class="count">({{ chapters.length }} 章)</span></div>
        <div v-if="!chapters.length" class="empty-state" style="padding:40px 0">暂无章节，去书城导入完整小说吧</div>
        <div v-else class="chapter-grid">
          <div v-for="c in visibleChapters" :key="c.id" class="chapter-item" @click="openReader(c.id)">
            <span class="ch-no">{{ String(c.idx + 1).padStart(3, '0') }}</span>
            <span class="ch-title">{{ c.title }}</span>
            <span class="ch-len">{{ fmtWords(c.words_count) }}</span>
          </div>
          <button v-if="chapters.length > CHAPTER_PREVIEW" class="btn btn-ghost ch-more" @click="showAllChapters = !showAllChapters">
            {{ showAllChapters ? '收起目录 ↑' : `展开全部 ${chapters.length} 章 ↓` }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.detail-page { max-width: 900px; margin: 0 auto; padding: 26px 20px 70px; }
.detail-hero {
  display: flex; gap: 32px; padding: 30px; border-radius: 20px;
  background: linear-gradient(135deg, rgba(124,92,191,.07), rgba(255,255,255,0));
  border: 1px solid var(--line);
}
.hero-cover { flex: 0 0 190px; }
.hero-cover .book-cover-wrap { width: 190px; }
.hero-info { flex: 1; min-width: 0; }
.hero-info h1 { font-size: 25px; font-weight: 800; }
.byline { color: var(--ink-dim); font-size: 14px; margin-top: 5px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.stats { display: flex; gap: 28px; margin: 18px 0; }
.stat b { display: block; font-size: 18px; font-weight: 800; }
.stat span { font-size: 12px; color: var(--ink-faint); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.dl-wrap { position: relative; display: inline-block; }
.dl-menu {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;
  background: #fff; border: 1px solid var(--line); border-radius: 12px;
  box-shadow: var(--shadow-md); padding: 6px; min-width: 150px;
}
.dl-item {
  display: block; width: 100%; text-align: left; padding: 9px 12px;
  background: none; border: none; border-radius: 8px; font-size: 13.5px;
  font-family: inherit; color: var(--ink); cursor: pointer; transition: background .15s;
}
.dl-item:hover { background: var(--brand-soft); color: var(--brand-deep); }
.desc-card {
  margin-top: 22px; padding: 22px 26px; background: #fff; border: 1px solid var(--line);
  border-radius: 16px; box-shadow: var(--shadow-sm); line-height: 1.9; font-size: 14.5px;
}
.desc-card h3 { font-size: 15px; color: var(--brand); margin-bottom: 8px; }
.count { font-size: 13px; color: var(--ink-faint); font-weight: 500; }
.chapter-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.chapter-item {
  display: flex; align-items: center; gap: 10px; padding: 12px 15px;
  background: #fff; border: 1px solid var(--line); border-radius: 11px; cursor: pointer;
  font-size: 13.5px; transition: all .16s; color: var(--ink);
}
.chapter-item:hover { border-color: var(--brand-light); color: var(--brand); transform: translateX(2px); box-shadow: var(--shadow-sm); }
.ch-no { color: var(--ink-faint); font-size: 11px; font-family: ui-monospace, monospace; min-width: 28px; }
.ch-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chapter-len { color: var(--ink-faint); font-size: 11px; }
.ch-more { grid-column: 1 / -1; justify-self: center; margin-top: 6px; padding: 10px 26px; font-size: 13.5px; }
/* ---------- 移动端适配 ---------- */
@media (max-width: 768px) {
  .detail-page { padding: 14px 12px 60px; }
  .detail-hero {
    flex-direction: column; align-items: center; gap: 18px;
    padding: 22px 16px; text-align: center;
  }
  .hero-cover { flex: 0 0 auto; }
  .hero-cover .book-cover-wrap { width: 190px; margin: 0 auto; }
  .tags { justify-content: center; }
  .stats { justify-content: center; gap: 22px; }
  .actions { justify-content: center; }
  .desc-card { padding: 16px 18px; font-size: 14px; }
  .chapter-grid { grid-template-columns: 1fr; }
  .section-title { margin: 22px 0 12px; }
}
</style>
