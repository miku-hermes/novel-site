<script setup>
import { useRouter } from 'vue-router';
import BookCover from './BookCover.vue';

const props = defineProps({ book: { type: Object, required: true } });
const router = useRouter();
</script>

<template>
  <div class="book-card" @click="router.push('/book/' + book.id)">
    <BookCover
      :title="book.title"
      :cover-url="book.cover_url"
      :author="book.author"
      :progress="book.progress || 0"
      :show-progress="!!book.in_shelf"
    />
    <div class="book-meta">
      <div class="book-title" :title="book.title">{{ book.title }}</div>
      <div class="book-author">{{ book.author || '佚名' }}</div>
      <div class="book-tags" v-if="book.tags && book.tags.length">
        <span v-for="t in book.tags.slice(0, 2)" :key="t" class="pill">{{ t }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-card { cursor: pointer; transition: transform .2s; }
.book-card:hover { transform: translateY(-4px); }
.book-meta { padding: 10px 2px 0; }
.book-title { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.book-author { font-size: 12px; color: var(--ink-faint); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.book-tags { margin-top: 5px; display: flex; gap: 5px; flex-wrap: wrap; }
.book-tags .pill { font-size: 10.5px; padding: 2px 8px; }
</style>
