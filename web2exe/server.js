const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 8080;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40MB of source files
const PKG_CLI = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TOTAL_BYTES, files: 200 }
});

function safeName(name) {
  return (name || 'app').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
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

    if (customServer) {
      // Bring their server.js in as-is — it's the real entry point, so
      // we trust it to serve/handle whatever it wants (commonly reading
      // from ./public itself, same layout as the default wrapper uses).
      fs.copyFileSync(customServer, path.join(workDir, 'server.js'));
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
      fs.copyFileSync(path.join(__dirname, 'wrapper-template.js'), path.join(workDir, 'server.js'));
    }

    fs.rmSync(rawDir, { recursive: true, force: true });

    // Assemble the pkg project.
    fs.writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({
      name: appName,
      version: '1.0.0',
      bin: 'server.js',
      pkg: { assets: ['public/**/*'] }
    }, null, 2));

    const outputExe = appName + '.exe';
    await new Promise((resolve, reject) => {
      execFile(process.execPath, [
        PKG_CLI, 'server.js',
        '--target', 'node22-win-x64',
        '--output', outputExe,
        // Building for Windows from a Linux host: skip V8 bytecode
        // caching entirely, since a bytecode cache baked on one V8
        // build is rejected at startup by a different host/target V8
        // (this was the actual cause of the "flashes and vanishes" bug).
        '--no-bytecode',
        '--public'
      ], { cwd: workDir, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
        if (err) {
          console.error(stdout, stderr);
          return reject(new Error('Build failed.'));
        }
        resolve();
      });
    });

    const exePath = path.join(workDir, outputExe);
    res.download(exePath, outputExe, (err) => {
      cleanup(workDir);
      if (err) console.error('Download error:', err.message);
    });
  } catch (err) {
    console.error(err);
    cleanup(workDir);
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
