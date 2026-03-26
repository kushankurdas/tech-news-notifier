# ---------- build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Data directory for seen-articles persistence
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

EXPOSE 0

CMD ["node", "dist/index.js"]
