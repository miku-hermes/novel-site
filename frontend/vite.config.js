import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import { presetUno, presetIcons } from 'unocss';

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS({
      presets: [
        presetUno(),
        presetIcons({
          scale: 1.1,
          extraProperties: {
            'display': 'inline-block',
            'vertical-align': '-0.15em',
          },
        }),
      ],
      theme: {
        colors: {
          brand: {
            DEFAULT: '#7c5cbf',
            light: '#b388ff',
            soft: '#e1bee7',
            deep: '#5c3d99',
          },
          ink: {
            DEFAULT: '#1f2333',
            dim: '#6b7288',
            faint: '#9aa1b5',
          },
          paper: '#f6f5f2',
          card: '#ffffff',
          line: '#e9e7e0',
        },
        fontFamily: {
          sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Segoe UI"', 'sans-serif'],
          serif: ['"Noto Serif SC"', '"Songti SC"', 'SimSun', 'serif'],
        },
        borderRadius: {
          xl2: '1.25rem',
        },
      },
    }),
  ],
  build: {
    outDir: '../public-dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5199,
    proxy: {
      '/api': 'http://127.0.0.1:3100',
    },
  },
});
