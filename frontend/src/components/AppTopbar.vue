<script setup>
import { useRouter, useRoute } from 'vue-router';
import { ref, onMounted, onUnmounted } from 'vue';
import { api, toast } from '../utils/api';

const router = useRouter();
const route = useRoute();
const user = ref(null);
const siteName = ref('喵的书架');
const show = ref(false);
const menuOpen = ref(false);
const isMobile = ref(false);

function checkMobile() {
  isMobile.value = window.innerWidth <= 1200;
  if (!isMobile.value) menuOpen.value = false;
}

onMounted(async () => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
  try {
    const d = await api.get('/api/auth/me');
    user.value = d.user;
  } catch (e) {
    router.push('/');
    return;
  }
  try { const s = await api.get('/api/site'); siteName.value = s.name; } catch (e) {}
  show.value = true;
});
onUnmounted(() => window.removeEventListener('resize', checkMobile));

async function logout() {
  try { await api.post('/api/auth/logout', {}); } catch (e) {}
  location.href = '/';
}

function go(path) {
  menuOpen.value = false;
  router.push(path);
}
</script>

<template>
  <header v-if="show" class="app-topbar">
    <div class="app-topbar-inner">
      <div class="brand-logo" @click="go('/home')">
        <span class="logo-ic i-mdi-bookshelf"></span>{{ siteName }}
      </div>

      <!-- 桌面端导航 -->
      <nav v-if="!isMobile" class="flex items-center gap-1">
        <button class="nav-link" :class="{ active: route.path === '/home' }" @click="go('/home')">书城</button>
        <button class="nav-link" :class="{ active: route.path === '/upload' }" @click="go('/upload')">导入</button>
        <button class="nav-link" :class="{ active: route.path === '/settings' }" @click="go('/settings')">设置</button>
        <button v-if="user && user.role === 'admin'" class="nav-link" :class="{ active: route.path === '/admin' }" @click="go('/admin')">管理</button>
        <button class="nav-link" @click="logout">退出</button>
      </nav>

      <!-- 移动端汉堡 -->
      <button v-else class="burger" @click="menuOpen = !menuOpen" aria-label="菜单">
        <span class="burger-line"></span>
        <span class="burger-line"></span>
        <span class="burger-line"></span>
      </button>
    </div>
  </header>

  <!-- 移动端抽屉菜单 -->
  <transition name="slide">
    <div v-if="show && isMobile && menuOpen" class="mobile-menu">
      <button class="mobile-link" :class="{ active: route.path === '/home' }" @click="go('/home')"><span class="i-mdi-home-outline mi"></span>书城</button>
      <button class="mobile-link" :class="{ active: route.path === '/upload' }" @click="go('/upload')"><span class="i-mdi-tray-arrow-up mi"></span>导入</button>
      <button class="mobile-link" :class="{ active: route.path === '/settings' }" @click="go('/settings')"><span class="i-mdi-cog-outline mi"></span>设置</button>
      <button v-if="user && user.role === 'admin'" class="mobile-link" :class="{ active: route.path === '/admin' }" @click="go('/admin')"><span class="i-mdi-shield-account-outline mi"></span>管理</button>
      <button class="mobile-link danger" @click="logout"><span class="i-mdi-logout-variant mi"></span>退出</button>
    </div>
  </transition>
</template>

<style scoped>
.nav-link {
  background: none; border: none; cursor: pointer; font-size: 14px; font-family: inherit;
  color: var(--ink-dim); padding: 7px 13px; border-radius: 9px; transition: all .18s;
}
.nav-link:hover { color: var(--ink); background: rgba(124,92,191,.07); }
.nav-link.active { color: var(--brand); background: var(--brand-soft); font-weight: 600; }
.brand-logo { cursor: pointer; user-select: none; }

/* 汉堡按钮 */
.burger {
  display: flex; flex-direction: column; justify-content: center; gap: 4px;
  width: 40px; height: 40px; background: none; border: none; cursor: pointer;
  border-radius: 10px; padding: 10px; transition: background .15s;
}
.burger:hover { background: rgba(124,92,191,.08); }
.burger-line { height: 2px; border-radius: 1px; background: var(--ink); transition: all .2s; }

/* 移动端抽屉 */
.mobile-menu {
  position: fixed; top: 58px; right: 12px; z-index: 100;
  background: #fff; border: 1px solid var(--line); border-radius: 14px;
  box-shadow: var(--shadow-lg); padding: 8px; min-width: 160px;
  display: flex; flex-direction: column; gap: 2px;
}
.mobile-link {
  display: flex; align-items: center; gap: 10px;
  background: none; border: none; text-align: left; cursor: pointer; font-family: inherit;
  font-size: 14.5px; color: var(--ink); padding: 11px 14px; border-radius: 9px; transition: all .15s;
}
.mi { font-size: 17px; }
.mobile-link:hover { background: rgba(124,92,191,.07); }
.mobile-link.active { color: var(--brand); background: var(--brand-soft); font-weight: 600; }
.mobile-link.danger { color: var(--danger); }
.slide-enter-active, .slide-leave-active { transition: opacity .18s, transform .18s; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
