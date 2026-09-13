const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const packager = require('electron-packager');

// electron-packager only shells out to Wine (via rcedit) when it thinks it
// needs to stamp version/name metadata into the packaged .exe — and it
// decides that's needed the moment ANY of appVersion/appCopyright/
// buildVersion/icon/win32metadata is set, which normally happens
// automatically by reading "version"/"author" out of package.json. We don't
// care about that metadata (the exe still runs and is named after the app —
// it just won't show a fancy version/company string in its Properties
// dialog), so we skip the check entirely. This removes the Wine dependency
// completely, which means Windows apps can be packaged from this plain
// Linux/Node server with no extra system dependencies.
require('electron-packager/src/win32').App.prototype.needsRcedit = () => false;

const app = express();
const PORT = process.env.PORT || 8080;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40MB of source files

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TOTAL_BYTES, files: 200 }
});

function safeName(name) {
  return (name || 'app').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

// electron-packager needs an explicit electron version (it normally reads
// one from an "electron" devDependency, which our generated apps don't
// have) — resolve the current stable release once and cache it, rather
// than pinning a version number that will eventually go stale.
let cachedElectronVersion = null;
async function getElectronVersion() {
  if (cachedElectronVersion) return cachedElectronVersion;
  const res = await fetch('https://registry.npmjs.org/electron/latest');
  if (!res.ok) throw new Error('Could not resolve an Electron version (npm registry lookup failed).');
  const data = await res.json();
  cachedElectronVersion = data.version;
  return cachedElectronVersion;
}

// Guards against zip-slip: resolved path must stay inside destRoot.
function safeJoin(destRoot, relPath) {
  const target = path.normalize(path.join(destRoot, relPath));
  if (!target.startsWith(destRoot + path.sep) && target !== destRoot) {
    throw new Error('Unsafe path in upload: ' + relPath);
  }
  return target;
}

function writeFileEnsuringDir(fullPath, data) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, data);
}

app.post('/build', upload.array('files'), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No files received.' });
  }

  const appName = safeName(req.body.appName);
  const jobId = crypto.randomBytes(6).toString('hex');
  const workDir = path.join(os.tmpdir(), 'web2exe-' + jobId);
  // Kept as a SIBLING of workDir, not nested inside it — electron-packager
  // copies everything under workDir into the packaged app, so an output
  // dir nested inside it would try to copy itself.
  const outDir = path.join(os.tmpdir(), 'web2exe-' + jobId + '-out');
  const rawDir = path.join(workDir, 'raw');
  const publicDir = path.join(workDir, 'public');

  try {
    fs.mkdirSync(rawDir, { recursive: true });

    // Single .zip drop: extract it (with zip-slip protection).
    if (files.length === 1 && /\.zip$/i.test(files[0].originalname)) {
      const zip = new AdmZip(files[0].buffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const rel = entry.entryName.replace(/^\/+/, '');
        const dest = safeJoin(rawDir, rel);
        writeFileEnsuringDir(dest, entry.getData());
      }
    } else {
      // Loose files (optionally with folder structure via relativePath field).
      const relPaths = [].concat(req.body.relativePath || []);
      files.forEach((f, i) => {
        const rel = relPaths[i] && relPaths[i].length ? relPaths[i] : f.originalname;
        const dest = safeJoin(rawDir, rel.replace(/^\/+/, ''));
        writeFileEnsuringDir(dest, f.buffer);
      });
    }

    // Walk once to find every file, so we can spot a custom server.js
    // and (for the no-server.js case) a lone .html file, wherever they
    // landed — including inside one wrapping folder from a zip.
    const allFiles = [];
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else allFiles.push(full);
      }
    })(rawDir);

    const serverCandidates = allFiles.filter(f => path.basename(f).toLowerCase() === 'server.js');
    if (serverCandidates.length > 1) {
      cleanup(workDir);
      return res.status(400).json({ error: 'Found more than one server.js — keep just the one you want used and try again.' });
    }
    const customServer = serverCandidates[0] || null;

    // Move everything except the chosen server.js into public/.
    fs.mkdirSync(publicDir, { recursive: true });
    for (const full of allFiles) {
      if (full === customServer) continue;
      const rel = path.relative(rawDir, full);
      const dest = path.join(publicDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(full, dest);
    }

    let mainTemplate;
    if (customServer) {
      // Bring their server.js in as-is (renamed, since main.js requires
      // it directly) — it's the real entry point, so we trust it to
      // serve/handle whatever it wants. Convention: it should listen on
      // process.env.PORT, which we set before requiring it.
      fs.copyFileSync(customServer, path.join(workDir, 'user-server.js'));
      mainTemplate = 'main-template-customserver.js';
    } else {
      // Default path: make sure there's an index.html. If not, but
      // there's exactly one .html file, promote it to index.html.
      const hasIndex = fs.existsSync(path.join(publicDir, 'index.html'));
      if (!hasIndex) {
        const htmlFiles = [];
        (function walk(dir) {
          for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (/\.html?$/i.test(name)) htmlFiles.push(full);
          }
        })(publicDir);
        if (htmlFiles.length === 1) {
          fs.copyFileSync(htmlFiles[0], path.join(publicDir, 'index.html'));
        } else {
          cleanup(workDir);
          return res.status(400).json({
            error: htmlFiles.length === 0
              ? 'No .html file found in what you dropped.'
              : 'Multiple .html files found and none is named index.html — rename your main page to index.html and try again.'
          });
        }
      }
      mainTemplate = 'main-template.js';
    }

    fs.rmSync(rawDir, { recursive: true, force: true });

    // Assemble the Electron project: a title-substituted main.js as the
    // entry point, plus a minimal package.json.
    const mainJs = fs.readFileSync(path.join(__dirname, mainTemplate), 'utf8')
      .replace(/__APP_TITLE__/g, appName.slice(0, 60));
    fs.writeFileSync(path.join(workDir, 'main.js'), mainJs);
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({
      name: appName.toLowerCase(),
      version: '1.0.0',
      main: 'main.js'
    }, null, 2));

    const electronVersion = await getElectronVersion();
    const appPaths = await packager({
      dir: workDir,
      name: appName,
      platform: 'win32',
      arch: 'x64',
      out: outDir,
      overwrite: true,
      asar: true,
      prune: true,
      electronVersion
    });

    if (!appPaths || !appPaths.length) {
      throw new Error('Packaging produced no output.');
    }
    const appDir = appPaths[0];
    const outputZip = path.join(outDir, appName + '.zip');
    // Built with the adm-zip library rather than shelling out to a system
    // `zip` binary — that binary isn't guaranteed to exist on whatever base
    // image is building this (it doesn't on Railway's default Node image),
    // and this way there's nothing to install at all.
    const outputArchive = new AdmZip();
    outputArchive.addLocalFolder(appDir, path.basename(appDir));
    await outputArchive.writeZipPromise(outputZip);

    res.download(outputZip, appName + '.zip', (err) => {
      cleanup(workDir);
      cleanup(outDir);
      if (err) console.error('Download error:', err.message);
    });
  } catch (err) {
    console.error(err);
    cleanup(workDir);
    cleanup(outDir);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

function cleanup(dir) {
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

app.listen(PORT, () => {
  console.log('web2exe listening on port ' + PORT);
  // Only auto-open a browser when running locally (Railway/production sets NODE_ENV).
  if (!process.env.RAILWAY_ENVIRONMENT) {
    const url = 'http://localhost:' + PORT + '/';
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? 'start "" "' + url + '"'
      : process.platform === 'darwin' ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
    exec(cmd, () => {});
  }
});
