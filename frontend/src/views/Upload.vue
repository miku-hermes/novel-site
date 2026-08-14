<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, toast } from '../utils/api';
import AppTopbar from '../components/AppTopbar.vue';

const router = useRouter();
const form = ref({ title: '', author: '', description: '', tags: '' });
const file = ref(null);
const uploading = ref(false);

function onFile(ev) { file.value = ev.target.files[0]; }

async function doUpload() {
  if (!form.value.title.trim()) { toast('请填写书名', true); return; }
  if (!file.value) { toast('请选择 .txt 或 .epub 文件', true); return; }
  uploading.value = true;
  try {
    const fd = new FormData();
    fd.append('title', form.value.title);
    fd.append('author', form.value.author);
    fd.append('description', form.value.description);
    fd.append('tags', form.value.tags);
    fd.append('file', file.value);
    const d = await api.post('/api/novels', fd, true);
    toast(`导入成功：${d.novel.chapter_count} 章`);
    router.push('/home');
  } catch (e) { toast(e.message, true); }
  uploading.value = false;
}
</script>

<template>
  <div>
    <AppTopbar />
    <div class="upload-wrap">
      <div class="upload-card">
        <h2><span class="i-mdi-tray-arrow-up mi"></span>导入小说</h2>
        <p class="sub">支持 TXT / EPUB，自动解析分章</p>
        <div class="field"><label>书名 *</label><input v-model="form.title" placeholder="必填"></div>
        <div class="field"><label>作者</label><input v-model="form.author" placeholder="选填"></div>
        <div class="field"><label>简介</label><textarea v-model="form.description" placeholder="选填"></textarea></div>
        <div class="field"><label>标签（逗号分隔）</label><input v-model="form.tags" placeholder="如：玄幻, 完结, 轻小说"></div>
        <div class="field">
          <label>选择文件（.txt / .epub）</label>
          <div class="dropzone" @click="$refs.fileInput.click()" @dragover.prevent @drop.prevent="onFile($event.dataTransfer)">
            <template v-if="!file"><span class="i-mdi-file-document-outline dz-ic"></span>点击选择或拖拽文件到此处<br><span class="dz-hint">TXT 按章节标题自动分章；EPUB 按目录读取。最大 50MB。</span></template>
            <template v-else><span class="i-mdi-check-circle-outline dz-ic ok"></span>{{ file.name }}</template>
            <input ref="fileInput" type="file" class="hidden-input" accept=".txt,.epub" @change="onFile">
          </div>
        </div>
        <button class="btn btn-primary w-full" :disabled="uploading" @click="doUpload">{{ uploading ? '导入中...' : '开始导入' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-wrap { max-width: 620px; margin: 0 auto; padding: 40px 24px; }
.upload-card { background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 34px; box-shadow: var(--shadow-md); }
.upload-card h2 { font-size: 21px; font-weight: 800; }
.sub { color: var(--ink-faint); font-size: 13px; margin: 6px 0 22px; }
.dropzone {
  border: 1.5px dashed var(--line); border-radius: 12px; padding: 34px 20px;
  text-align: center; font-size: 14px; color: var(--ink-dim); cursor: pointer; transition: all .2s; background: #faf9f6;
}
.dropzone:hover { border-color: var(--brand-light); background: var(--brand-soft); }
.dz-hint { font-size: 12px; color: var(--ink-faint); }
.dz-ic { font-size: 42px; color: var(--brand-light); margin-bottom: 10px; }
.dz-ic.ok { color: var(--ok); font-size: 20px; margin: 0 8px 0 0; }
.hidden-input { display: none; }
.w-full { width: 100%; }
/* 移动端适配 */
@media (max-width: 768px) {
  .upload-wrap { padding: 20px 14px; }
  .upload-card { padding: 22px 18px; border-radius: 16px; }
  .upload-card h2 { font-size: 19px; }
  .dropzone { padding: 24px 14px; }
}
</style>
