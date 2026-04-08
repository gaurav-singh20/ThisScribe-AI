# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

# Keep upload directory available in the image; compose mounts a persistent volume here.
RUN mkdir -p /app/uploads

EXPOSE 5001
CMD ["node", "server.js"]
