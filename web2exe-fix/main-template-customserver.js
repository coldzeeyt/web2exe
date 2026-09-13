// Electron main process for apps that bring their own server.js.
// Picks a free port, sets it as process.env.PORT, then requires the
// user's server.js in-process (it's expected to call .listen() itself,
// reading process.env.PORT) and opens a native window pointed at it.
const { app, BrowserWindow } = require('electron');
const net = require('net');
const path = require('path');

function findFreePort(start, cb) {
  const tester = net.createServer();
  tester.once('error', () => {
    if (start < 51273) findFreePort(start + 1, cb);
    else cb(51173); // give up trying to avoid clashes, just use the default
  });
  tester.once('listening', () => tester.close(() => cb(start)));
  tester.listen(start, '127.0.0.1');
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
  findFreePort(51173, (port) => {
    process.env.PORT = String(port);
    require(path.join(__dirname, 'user-server.js'));
    // Give the user's server a moment to finish starting before we point
    // the window at it — we have no generic "ready" signal for arbitrary
    // scripts, so this is a pragmatic fixed delay.
    setTimeout(() => createWindow(port), 400);
  });
});

app.on('window-all-closed', () => app.quit());
