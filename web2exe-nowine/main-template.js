// Electron main process — this becomes the entry point of the packaged
// app. It serves ./public on a local port and opens a real native
// window pointed at it (title bar, minimize/maximize/close all native —
// no browser tab, no console window).
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html', '.htm': 'text/html',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain', '.wasm': 'application/wasm'
};

function handle(req, res) {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found: ' + urlPath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    res.writeHead(500);
    res.end('Server error: ' + (err && err.message));
  }
}

function startServer(onReady) {
  function tryListen(port) {
    const server = http.createServer(handle);
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < 51273) {
        tryListen(port + 1);
      } else {
        console.error('Could not start server:', err);
        app.quit();
      }
    });
    server.listen(port, '127.0.0.1', () => onReady(port));
  }
  tryListen(51173);
}

let mainWindow;
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: '__APP_TITLE__',
    autoHideMenuBar: true,
    backgroundColor: '#111111'
  });
  mainWindow.loadURL('http://127.0.0.1:' + port + '/');
}

app.whenReady().then(() => {
  startServer(createWindow);
});

app.on('window-all-closed', () => app.quit());
