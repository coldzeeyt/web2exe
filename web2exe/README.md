# web2exe

Drop a website in, get a Windows `.exe` out. It bundles a tiny local server
around your files (using [pkg](https://github.com/yao-pkg/pkg)) so the
result is a single portable binary — no install, no Node required on the
machine that runs it. Double-clicking it opens your default browser to a
page it serves from `localhost`.

## Run it locally

Needs [Node.js](https://nodejs.org) installed.

- Windows: double-click `start.bat`.
- Mac/Linux: `npm install && npm start`.

Either way it opens `http://localhost:8080` in your browser automatically.
Drop in a single `.html` file, a folder, or a `.zip`, hit **Build .exe**,
and it downloads the packaged executable.

## Deploy it as a real site (optional)

A Railway project called **web2exe** is already set up and waiting for
this code. To wire it up:

1. Create a new empty repo on GitHub (any name).
2. In this folder: `git init && git add . && git commit -m "init"`
3. `git remote add origin <your-repo-url> && git push -u origin main`
4. Tell Claude the repo name (`your-username/your-repo`) and it'll connect
   Railway to it and hand you back a public URL.

## How it works

Each build spins up a throwaway pkg project: your files go into `public/`,
a small static-file server (`wrapper-template.js`) becomes the entry
point, and `pkg` cross-compiles the pair into a `node22-win-x64`
executable. The first build after a while is slower while pkg fetches
its base Windows Node binary; after that it's cached.
