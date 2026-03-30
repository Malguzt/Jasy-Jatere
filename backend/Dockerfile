FROM node:20-slim

# Instalar ffmpeg para conversiones RTSP -> MPEG WebSocket
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Backend principal
EXPOSE 4000

CMD ["node", "server.js"]
