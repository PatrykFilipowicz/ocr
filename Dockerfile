FROM node:18-slim

# Instaluj narzędzia OCR
RUN apt-get update && apt-get install -y \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-pol \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Ustawienia aplikacji
WORKDIR /app

# Instaluj zależności npm
COPY package*.json ./
RUN npm ci --only=production

# Kopiuj kod
COPY . .

# Port
EXPOSE 8000

# Uruchom
CMD ["node", "server.js"]