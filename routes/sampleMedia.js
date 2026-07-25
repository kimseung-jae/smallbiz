const fs = require('fs');
const path = require('path');

const SAMPLE_DIR = path.join(__dirname, '..', 'sample-media');

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.mp4', '.mov', '.m4v'].includes(ext)) return 'video/mp4';
  if (ext === '.png') return 'image/png';
  return 'image/jpeg';
}

function getSampleFiles(limit) {
  if (!fs.existsSync(SAMPLE_DIR)) return [];
  const files = fs
    .readdirSync(SAMPLE_DIR)
    .filter((f) => !f.startsWith('.'))
    .sort()
    .map((f) => ({ path: path.join(SAMPLE_DIR, f), mimetype: mimeFromExt(f), isSample: true }));
  return limit ? files.slice(0, limit) : files;
}

module.exports = { getSampleFiles, SAMPLE_DIR };
