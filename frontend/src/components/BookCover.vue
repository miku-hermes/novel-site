<script setup>
import { useRoute } from 'vue-router';
import { coverBg, coverChar } from '../utils/cover';

const props = defineProps({
  title: { type: String, default: '' },
  coverUrl: { type: String, default: null },
  author: { type: String, default: '' },
  progress: { type: Number, default: 0 },
  size: { type: String, default: 'md' }, // sm | md | lg
  showProgress: { type: Boolean, default: false },
});
const emit = defineEmits(['open']);

const style = coverBg(props.title, props.author);
</script>

<template>
  <div class="book-cover-wrap" :class="'size-' + size" @click="emit('open')">
    <div v-if="coverUrl" class="cov-img"><img :src="coverUrl" :alt="title" loading="lazy"></div>
    <div v-else class="cov-fallback" :style="style">
      <span class="cov-char">{{ coverChar(title) }}</span>
      <span class="cov-title">{{ title.slice(0, 8) }}</span>
      <span class="cov-glow"></span>
    </div>
    <div v-if="showProgress && progress > 0" class="cov-progress">
      <div class="cov-progress-bar" :style="{ width: Math.round(progress * 100) + '%' }"></div>
    </div>
  </div>
</template>

<style scoped>
.book-cover-wrap { position: relative; cursor: pointer; }
.cov-img, .cov-fallback {
  width: 100%; aspect-ratio: 3/4; border-radius: 10px; overflow: hidden;
  box-shadow: 0 6px 18px rgba(31,35,51,.16), 0 2px 6px rgba(31,35,51,.1);
  position: relative;
}
.cov-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cov-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.cov-char { font-size: 46px; font-weight: 800; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,.5), 0 0 3px rgba(0,0,0,.35); }
.cov-title {
  font-size: 11px; color: rgba(255,255,255,.92); letter-spacing: .14em; padding: 0 10px;
  text-align: center; line-height: 1.5; overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  text-shadow: 0 1px 5px rgba(0,0,0,.5);
}
/* 顶部高光 + 底部渐隐 */
.cov-fallback::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255,255,255,.14), transparent);
  pointer-events: none; z-index: 0;
}
.cov-fallback::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 45%;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.42));
  pointer-events: none; z-index: 0;
}
.cov-fallback .cov-char, .cov-fallback .cov-title { position: relative; z-index: 1; }
.cov-glow { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.cov-progress { position: absolute; left: 8px; right: 8px; bottom: 7px; height: 4px; background: rgba(255,255,255,.55); border-radius: 2px; overflow: hidden; }
.cov-progress-bar { height: 100%; background: linear-gradient(90deg, #7c5cbf, #b388ff); border-radius: 2px; }
.size-sm .cov-img, .size-sm .cov-fallback { border-radius: 8px; }
.size-sm .cov-char { font-size: 26px; }
.size-sm .cov-title { font-size: 9px; }
.size-lg .cov-img, .size-lg .cov-fallback { border-radius: 14px; box-shadow: 0 14px 38px rgba(31,35,51,.2); }
.size-lg .cov-char { font-size: 60px; }
.size-lg .cov-title { font-size: 13px; }
</style>
