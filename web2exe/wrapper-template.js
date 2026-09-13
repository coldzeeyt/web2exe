// This file is bundled into the output .exe as the app's entry point.
// It serves the user's dropped site from ./public on localhost and opens
// the default browser to it. No native window chrome — just a local
// server + a browser tab, which is what makes this reliably buildable
// without a full browser-engine runtime like Electron/Tauri.
console.log('Starting...');

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Never let this window vanish silently. If anything throws, write it
// next to the exe as error.log and hold the console open so it's
// actually readable instead of flashing shut.
function fatal(err) {
  const text = (err && err.stack) ? err.stack : String(err);
  try {
    const dir = path.dirname(process.execPath);
    fs.writeFileSync(path.join(dir, 'error.log'), text + '\n');
  } catch (e) { /* best effort */ }
  console.error('\nSomething went wrong:\n' + text);
  console.error('\n(this was also saved as error.log next to the app)');
  try {
    process.stdout.write('\nPress Enter to close this window...');
    require('readline').createInterface({ input: process.stdin, output: process.stdout })
      .question('', () => process.exit(1));
  } catch (e) {
    process.exit(1);
  }
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

try {
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

  function tryListen(port, onOk) {
    const server = http.createServer(handle);
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < 51273) {
        tryListen(port + 1, onOk);
      } else {
        fatal(err);
      }
    });
    server.listen(port, '127.0.0.1', () => onOk(port));
  }

  console.log('Looking for your files in ' + PUBLIC_DIR);

  tryListen(51173, (port) => {
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('Running your app at ' + url);
    console.log('(Leave this window open. Close it to quit.)');
    const cmd = process.platform === 'win32'
      ? 'start "" "' + url + '"'
      : process.platform === 'darwin'
        ? 'open "' + url + '"'
        : 'xdg-open "' + url + '"';
    exec(cmd, (err) => {
      if (err) console.error('Could not auto-open a browser (open ' + url + ' manually): ' + err.message);
    });
  });
} catch (err) {
  fatal(err);
}
