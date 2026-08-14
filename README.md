# 喵的书架 (novel-site)

自托管小说存储与阅读站点。Node.js + Express + SQLite 后端，Vue 3 + Vite + UnoCSS 前端。

## 特性

- 🔐 **安全默认**：scrypt 密码哈希、强制 TOTP 2FA、恢复码单次消费、CSRF 双提交、全局限流、登录失败锁定、审计日志
- 📚 **书城**：搜索 / 分类 / 排序 / 分页 / 我的书架 / 最近阅读
- 📖 **阅读器**：进度同步、主题 / 字号调节、侧滑目录
- 📥 **导入**：TXT 自动分章（Legado 式规则库 + 自动探测）、EPUB（fast-xml-parser）
- ⬇️ **导出**：整本下载 TXT / EPUB
- 🛡️ **管理后台**：小说管理（编辑 / 换封面 / 删除）、用户、备份、日志、站点设置
- 📱 **移动端适配**：响应式布局 + 汉堡菜单

## 快速开始

```bash
# 本地开发
npm install
cd frontend && npm install && npm run build
cd .. && DATA_DIR=./data PORT=3000 node src/server.js

# 测试
npm test

# Docker 部署
docker compose up -d --build
```

## 环境变量

见 `.env.example`。生产环境必改：

| 变量 | 说明 |
|------|------|
| `SESSION_SECRET` | 会话签名密钥（>=32 字符随机串） |
| `BACKUP_PASSWORD` | 备份加密口令 |
| `ALLOW_REGISTER` | 是否允许新用户注册 |
| `SITE_NAME` | 站点标题 |

## 说明

- 首个注册用户自动成为管理员
- 注册后强制绑定 2FA 才能登录
- 普通用户可上传小说，写操作（编辑 / 删除 / 换封面）仅管理员
- 依赖审计与测试由 GitHub Actions 在 CI 中自动执行
