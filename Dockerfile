FROM node:20-alpine

WORKDIR /app

# 仅复制依赖文件，利用 Docker 缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制源码
COPY src/ ./src/

# 数据目录（建议挂载卷）
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000

CMD ["node", "src/index.js"]
