import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', component: () => import('./views/Login.vue') },
  { path: '/home', component: () => import('./views/Home.vue') },
  { path: '/book/:id', component: () => import('./views/BookDetail.vue') },
  { path: '/read/:id', component: () => import('./views/Reader.vue') },
  { path: '/upload', component: () => import('./views/Upload.vue') },
  { path: '/settings', component: () => import('./views/Settings.vue') },
  { path: '/admin', component: () => import('./views/Admin.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
