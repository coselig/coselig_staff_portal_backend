const fs = require('node:fs');
const path = require('node:path');

function existingDir(dirPath) {
  return Boolean(dirPath) && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function resolveBuildDir() {
  if (existingDir(process.env.FRONTEND_BUILD_DIR)) {
    return process.env.FRONTEND_BUILD_DIR;
  }

  if (existingDir(process.env.FRONTEND_DIR)) {
    const envBuildDir = path.join(process.env.FRONTEND_DIR, 'build', 'web');
    if (existingDir(envBuildDir)) {
      return envBuildDir;
    }
  }

  const parentDir = path.dirname(__dirname);
  const backendName = path.basename(__dirname);
  const candidates = [
    path.join(parentDir, 'front', 'build', 'web'),
    path.join(parentDir, 'coselig_staff_portal_frontend', 'build', 'web'),
  ];

  if (backendName.endsWith('_backend')) {
    candidates.push(path.join(parentDir, `${backendName.slice(0, -'_backend'.length)}_frontend`, 'build', 'web'));
  }
  if (backendName.endsWith('-backend')) {
    candidates.push(path.join(parentDir, `${backendName.slice(0, -'-backend'.length)}-frontend`, 'build', 'web'));
  }

  for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/front/i.test(entry.name)) {
      continue;
    }
    const candidate = path.join(parentDir, entry.name, 'build', 'web');
    if (existingDir(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    if (existingDir(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate Flutter web build directory. Set FRONTEND_DIR or FRONTEND_BUILD_DIR first.');
}

const buildDir = resolveBuildDir();

function getFiles(dir, prefix = '') {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getFiles(fullPath, prefix + item + '/'));
    } else {
      const key = prefix + item;
      const value = fs.readFileSync(fullPath, 'base64');
      files.push({ key, value, base64: true });
    }
  }
  return files;
}

const files = getFiles(buildDir);
fs.writeFileSync(path.join(__dirname, 'assets.json'), JSON.stringify(files, null, 2));
console.log(`Generated assets.json with ${files.length} files from ${buildDir}`);
