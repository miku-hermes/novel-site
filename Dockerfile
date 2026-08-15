# 多阶段构建：前端构建 + 后端
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build
# outDir: ../public-dist → /app/public-dist
RUN ls /app/public-dist

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY --from=frontend /app/public-dist ./public-dist

ENV NODE_ENV=production
ENV PORT=3000

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "src/server.js"]
