FROM node:22-bookworm

# wine is required by electron-packager's rcedit step when packaging a
# Windows target from a Linux build machine (it writes version/name
# metadata into the packaged .exe). zip is used to bundle the final app.
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends wine wine32:i386 wine64 zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
