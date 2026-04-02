FROM node:20-slim

# Instalar ffmpeg y toolchain mínima para dependencias nativas (por ejemplo SQLite bindings)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Backend principal
EXPOSE 4000

CMD ["node", "server.js"]
