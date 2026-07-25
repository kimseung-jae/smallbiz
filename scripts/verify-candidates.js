const fs = require('fs');
const path = require('path');
const axios = require('axios');

const candidates = require('./candidates.json');
const OUT_PATH = path.join(__dirname, '..', 'public', 'verified-examples.json');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function checkOne(query) {
  try {
    const res = await axios.get('http://localhost:3000/api/place-search', {
      params: { query },
      timeout: 8000,
    });
    return (res.data.places || []).length > 0;
  } catch {
    return false;
  }
}

(async () => {
  const verified = [];
  let existing = [];
  if (fs.existsSync(OUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'));
  }
  const verifiedSet = new Set(existing);

  for (let i = 0; i < candidates.length; i++) {
    const name = candidates[i];
    if (verifiedSet.has(name)) continue;
    const ok = await checkOne(name);
    if (ok) {
      verified.push(name);
      verifiedSet.add(name);
    }
    if (i % 20 === 0) {
      console.log(`progress: ${i}/${candidates.length}, verified so far: ${verifiedSet.size}`);
      fs.writeFileSync(OUT_PATH, JSON.stringify([...verifiedSet], null, 0));
    }
    await sleep(1100); // Nominatim usage policy: max 1 req/sec
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify([...verifiedSet], null, 0));
  console.log(`DONE. total candidates: ${candidates.length}, verified: ${verifiedSet.size}`);
})();
