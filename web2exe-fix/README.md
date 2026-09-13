# web2exe

Drop a website in, get a real Windows app back — its own window with a
title bar, minimize/maximize/close, pinnable to the taskbar. No browser
tab, no console window. Built with [Electron](https://www.electronjs.org/),
packaged with [`electron-packager`](https://github.com/electron/electron-packager).

## Run it locally

Needs [Node.js](https://nodejs.org).

- Windows: double-click `start.bat`.
- Mac/Linux: `npm install && npm start`.

Either way it opens `http://localhost:8080` in your browser. Drop in a
single `.html` file, a folder, or a `.zip`, hit **Build**, and it hands
you back a `.zip` — unzip it and run the `.exe` inside.

No Wine, no Docker, no extra system dependencies needed — packaging a
Windows app from Linux/Mac normally needs Wine installed (electron-packager
uses it to stamp version metadata into the exe), but this project skips
that step entirely, so plain Node is all it takes.

## Deploy it as a real site (optional)

A Railway project called **web2exe** is already set up and waiting for
this code, using Railway's plain Node builder (no Dockerfile needed).

1. Create a new empty repo on GitHub (any name).
2. In this folder: `git init && git add . && git commit -m "init"`
3. `git remote add origin <your-repo-url> && git push -u origin main`
4. Tell Claude the repo name (`your-username/your-repo`) and it'll connect
   Railway to it and hand you back a public URL.

## How it works

Each build assembles a throwaway Electron project: your files go into
`public/`, a small entry script (`main-template.js`) starts a tiny local
static-file server and opens a native `BrowserWindow` pointed at it, and
`electron-packager` bundles the pair into a `win32-x64` app. The first
build after a while is slower while Electron's base binary downloads;
after that it's cached.

If you drop in a `server.js` alongside your files, it's used instead of
the default static server — it's required directly into the Electron
main process, so it should stick to core Node modules (no npm packages)
and listen on `process.env.PORT`.

Note: the packaged `.exe`'s file properties (version, company name, etc.)
are left at Electron's defaults, since filling those in is the one thing
that would require Wine. The app still runs and is named after your app —
this is purely cosmetic metadata nobody but Windows Explorer's Properties
dialog ever looks at.
