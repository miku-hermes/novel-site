<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api, fmtWords } from '../utils/api';
import AppTopbar from '../components/AppTopbar.vue';
import BookCover from '../components/BookCover.vue';
import BookCard from '../components/BookCard.vue';

const router = useRouter();
const viewMode = ref('library'); // library | shelf
const query = ref('');
const sort = ref('updated');
const novels = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 24;
const pages = ref(0);
const recent = ref([]);
const shelf = ref([]);
const tagCounts = ref({});
const activeTag = ref('');
const loading = ref(true);

async function loadLibrary() {
  loading.value = true;
  try {
    const q = activeTag.value ? '#' + activeTag.value : query.value.trim();
    const d = await api.get(`/api/novels?sort=${sort.value}&q=${encodeURIComponent(q)}&page=${page.value}&pageSize=${pageSize}`);
    novels.value = d.items;
    total.value = d.total;
    pages.value = Math.ceil(d.total / d.pageSize);
    const counts = {};
    d.items.forEach(n => n.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    tagCounts.value = counts;
  } catch (e) { /* 忽略 */ }
  loading.value = false;
}

async function loadRecent() {
  try {
    const d = await api.get('/api/me/recent');
    recent.value = d.items;
  } catch (e) {}
}

async function loadShelf() {
  loading.value = true;
  try {
    const d = await api.get('/api/me/bookshelf');
    shelf.value = d.items;
  } catch (e) {}
  loading.value = false;
}

function switchView(mode) {
  viewMode.value = mode;
  if (mode === 'shelf' && !shelf.value.length) loadShelf();
  window.scrollTo({ top: 0 });
}

function doSearch() { page.value = 1; loadLibrary(); }
function changeSort() { page.value = 1; loadLibrary(); }
function setTag(t) { activeTag.value = t; page.value = 1; loadLibrary(); }
function clearTag() { activeTag.value = ''; page.value = 1; loadLibrary(); }
function goto(p) { page.value = p; loadLibrary(); window.scrollTo({ top: 0 }); }

onMounted(() => { loadRecent(); loadLibrary(); });
</script>

<template>
  <div>
    <AppTopbar />
    <div class="container">
      <!-- 视图切换 -->
      <div class="view-tabs">
        <button class="view-tab" :class="{ active: viewMode === 'library' }" @click="switchView('library')"><span class="i-mdi-bookshelf mi"></span>书城</button>
        <button class="view-tab" :class="{ active: viewMode === 'shelf' }" @click="switchView('shelf')"><span class="i-mdi-star-outline mi"></span>我的书架 <span v-if="shelf.length" class="view-count">{{ shelf.length }}</span></button>
      </div>

      <!-- ===== 书城视图 ===== -->
      <template v-if="viewMode === 'library'">
        <!-- 搜索 -->
        <div class="search-box">
          <input v-model="query" placeholder="搜索书名 / 作者 / 简介..." @keyup.enter="doSearch">
          <span class="search-ic i-mdi-magnify"></span>
        </div>

        <!-- 最近阅读 -->
        <div v-if="recent.length" class="recent-section">
          <div class="section-title">最近阅读</div>
          <div class="cover-strip">
            <div v-for="b in recent" :key="b.id" class="strip-item" @click="router.push('/book/' + b.id)">
              <BookCover :title="b.title" :cover-url="b.cover_url" :author="b.author" :progress="b.progress || 0" :show-progress="true" size="sm" />
              <div class="strip-title">{{ b.title }}</div>
              <div class="strip-sub">{{ b.author || '佚名' }} · {{ fmtWords(b.words_count) }} · {{ b.chapter_count }} 章</div>
            </div>
          </div>
        </div>

        <!-- 全部小说 -->
        <div class="section-title" style="justify-content:space-between">
          <span>{{ activeTag ? '#' + activeTag : '全部小说' }} <span class="count">({{ total }})</span></span>
          <select v-model="sort" class="sort-select" @change="changeSort">
            <option value="updated">最近更新</option>
            <option value="created">最近创建</option>
            <option value="words">字数最多</option>
            <option value="title">书名排序</option>
          </select>
        </div>

        <!-- 分类 chips -->
        <div class="chip-row">
          <button class="chip" :class="{ active: !activeTag }" @click="clearTag">全部</button>
          <button v-for="(c, t) in tagCounts" :key="t" class="chip" :class="{ active: activeTag === t }" @click="setTag(t)">
            {{ t }} ({{ c }})
          </button>
        </div>

        <!-- 网格 -->
        <div v-if="loading" class="empty-state">加载中...</div>
        <div v-else-if="!novels.length" class="empty-state">
          <div class="big i-mdi-bookshelf"></div>书架空空如也<br>去「导入」页上传你的第一本小说吧
        </div>
        <div v-else class="book-grid">
          <BookCard v-for="b in novels" :key="b.id" :book="b" />
        </div>

        <!-- 分页 -->
        <div v-if="pages > 1" class="pager">
          <button v-for="p in pages" :key="p" class="page-btn" :class="{ cur: p === page }" @click="goto(p)">{{ p }}</button>
        </div>
      </template>

      <!-- ===== 我的书架视图 ===== -->
      <template v-else>
        <div class="shelf-head">
          <div class="section-title"><span class="i-mdi-star-outline tic"></span>我的书架 <span class="count">({{ shelf.length }})</span></div>
          <span class="shelf-hint">在详情页点「＋ 加入书架」收藏的书会出现在这里</span>
        </div>
        <div v-if="loading" class="empty-state">加载中...</div>
        <div v-else-if="!shelf.length" class="empty-state">
          <div class="big i-mdi-star-outline"></div>书架还是空的<br>去书城逛逛，把喜欢的书加进来吧
        </div>
        <div v-else class="book-grid">
          <BookCard v-for="b in shelf" :key="b.id" :book="b" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.container { max-width: 1120px; margin: 0 auto; padding: 22px 24px 70px; }
/* 视图切换 */
.view-tabs { display: flex; gap: 8px; margin-bottom: 18px; }
.view-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 999px; border: 1.5px solid var(--line);
  background: #fff; font-size: 14px; font-family: inherit; font-weight: 600;
  color: var(--ink-dim); cursor: pointer; transition: all .18s;
}
.view-tab:hover { border-color: var(--brand-light); color: var(--brand); }
.view-tab.active { background: linear-gradient(135deg, #7c5cbf, #9d7ee8); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(124,92,191,.28); }
.view-count { background: rgba(255,255,255,.22); border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.shelf-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.shelf-hint { font-size: 12.5px; color: var(--ink-faint); }
.search-box { max-width: 560px; margin: 0 auto; position: relative; }
.search-box input {
  width: 100%; height: 46px; font-size: 15px; padding: 0 50px 0 20px; font-family: inherit;
  background: #fff; border: 1.5px solid var(--line); border-radius: 23px; outline: none;
  box-shadow: var(--shadow-sm); transition: all .2s;
}
.search-box input:focus { border-color: var(--brand-light); box-shadow: 0 0 0 4px rgba(124,92,191,.1); }
.search-ic { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-size: 16px; }
.recent-section { margin-top: 6px; }
.cover-strip { display: flex; gap: 18px; overflow-x: auto; padding: 4px 2px 14px; }
.strip-item { flex: 0 0 108px; cursor: pointer; transition: transform .18s; }
.strip-item:hover { transform: translateY(-3px); }
.strip-title { font-size: 12.5px; font-weight: 600; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; color: var(--ink); }
.strip-sub { font-size: 11px; color: var(--ink-faint); margin-top: 2px; text-align: center; }
.count { font-size: 13px; color: var(--ink-faint); font-weight: 500; }
.sort-select { border: 1px solid var(--line); border-radius: 9px; padding: 7px 10px; font-size: 13px; font-family: inherit; background: #fff; color: var(--ink); outline: none; }
.chip-row {
  display: flex; gap: 8px; margin-bottom: 20px;
  overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px;
  -webkit-overflow-scrolling: touch; scrollbar-width: none;
}
.chip-row::-webkit-scrollbar { display: none; }
.chip {
  flex: 0 0 auto; padding: 7px 15px; border-radius: 999px; font-size: 13px; font-family: inherit; cursor: pointer;
  background: #fff; border: 1px solid var(--line); color: var(--ink-dim); transition: all .18s;
}
.chip:hover { border-color: var(--brand-light); color: var(--brand); }
.chip.active { background: linear-gradient(135deg, #7c5cbf, #9d7ee8); color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(124,92,191,.28); }
.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 22px 18px; }
.pager { display: flex; justify-content: center; gap: 6px; margin-top: 28px; }
.page-btn {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); background: #fff;
  font-size: 13px; cursor: pointer; color: var(--ink-dim); transition: all .15s;
}
.page-btn.cur { background: var(--brand); color: #fff; border-color: transparent; }
.page-btn:hover:not(.cur) { border-color: var(--brand-light); color: var(--brand); }
</style>
