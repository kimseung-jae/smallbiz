const photoInput = document.getElementById('photoInput');
const uploadBox = document.getElementById('uploadBox');
const uploadEmpty = document.getElementById('uploadEmpty');
const previewRow = document.getElementById('previewRow');
const storeNameInput = document.getElementById('storeName');
const introTextInput = document.getElementById('introText');
const moodSelect = document.getElementById('moodSelect');
const generateBtn = document.getElementById('generateBtn');
const statusBox = document.getElementById('statusBox');
const statusText = document.getElementById('statusText');
const resultBox = document.getElementById('resultBox');
const posterArea = document.getElementById('posterArea');
const reelsArea = document.getElementById('reelsArea');
const errorBox = document.getElementById('errorBox');
const mapSearchInput = document.getElementById('mapSearchInput');
const mapSearchBtn = document.getElementById('mapSearchBtn');
const mapResultInfo = document.getElementById('mapResultInfo');
const fetchBlogBtn = document.getElementById('fetchBlogBtn');
const blogCandidates = document.getElementById('blogCandidates');

fetchBlogBtn.addEventListener('click', async () => {
  const storeName = storeNameInput.value.trim();
  if (!storeName) {
    blogCandidates.innerHTML = '<div class="blog-note">매장명을 먼저 입력해주세요.</div>';
    return;
  }

  fetchBlogBtn.disabled = true;
  blogCandidates.innerHTML = '<div class="blog-note">블로그 후기 찾는 중...</div>';

  try {
    const res = await fetch('/api/store-intro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeName }),
    });
    const data = await res.json();

    if (data.needsApiKey) {
      blogCandidates.innerHTML = `<div class="blog-note">${data.message}</div>`;
      return;
    }
    if (!res.ok) throw new Error(data.error || '블로그 후기 가져오기 실패');

    const candidates = data.candidates || [];
    if (!candidates.length) {
      blogCandidates.innerHTML = `<div class="blog-note">${data.message || '관련 블로그 포스트를 찾지 못했어요. 직접 입력해주세요.'}</div>`;
      return;
    }

    blogCandidates.innerHTML = candidates
      .map((c, i) => `<button type="button" class="blog-candidate" data-idx="${i}">${i + 1}. ${c}</button>`)
      .join('') + '<div class="blog-note">마음에 드는 걸 탭하면 아래 소개글에 채워져요. 직접 수정도 가능해요.</div>';

    blogCandidates.querySelectorAll('.blog-candidate').forEach((btn) => {
      btn.addEventListener('click', () => {
        introTextInput.value = candidates[Number(btn.dataset.idx)];
      });
    });
  } catch (err) {
    blogCandidates.innerHTML = `<div class="blog-note">오류: ${err.message}</div>`;
  } finally {
    fetchBlogBtn.disabled = false;
  }
});

let selectedFiles = [];

// "예:" 플레이스홀더를 실제 검색해서 잘 나오는 이름들 중 랜덤으로 골라서 채움
function applyRandomExamples(names) {
  if (!names || !names.length) return;
  const name = names[Math.floor(Math.random() * names.length)];
  mapSearchInput.placeholder = `예: ${name}`;
  storeNameInput.placeholder = `예: ${name}`;
  introTextInput.placeholder = `예: ${name}에서 자랑하는 대표메뉴·강점을 적어주세요`;
}

(async function applyDefaultExamples() {
  try {
    const res = await fetch('/verified-examples.json');
    if (!res.ok) return;
    applyRandomExamples(await res.json());
  } catch {
    // 검증 리스트가 아직 없으면 기존 하드코딩 placeholder 그대로 둠
  }
})();

// ===== 네이버 지도: 매장 위치 검색 =====
let naverMap = null;
let naverMarker = null;
let naverMapAuthFailed = false;

// 네이버 지도 API가 도메인 인증 실패 시 호출하는 전역 콜백
window.navermap_authFailure = function () {
  naverMapAuthFailed = true;
  mapResultInfo.textContent = '⚠️ 지도 키가 이 주소(도메인)에 아직 등록되지 않았어요. 매장명/한 줄 소개는 아래에서 직접 입력해주세요 — 지도 없이도 나머지 기능은 정상 작동해요.';
  const mapEl = document.getElementById('mapEl');
  if (mapEl) mapEl.style.display = 'none';
};

function initNaverMap() {
  if (typeof naver === 'undefined' || !naver.maps) {
    mapResultInfo.textContent = '지도를 불러오지 못했어요. 매장명/한 줄 소개는 아래에서 직접 입력해주세요.';
    return;
  }
  try {
    naverMap = new naver.maps.Map('mapEl', {
      center: new naver.maps.LatLng(37.5665, 126.9780), // 서울 시청 기본값 (위치 권한 거부/실패 시)
      zoom: 14,
    });
    centerOnUserLocationAndFetchNearby();
  } catch (err) {
    mapResultInfo.textContent = '지도를 불러오지 못했어요. 매장명/한 줄 소개는 아래에서 직접 입력해주세요.';
  }
}

function centerOnUserLocationAndFetchNearby() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const point = new naver.maps.LatLng(latitude, longitude);
      naverMap.setCenter(point);
      naverMap.setZoom(16);
      new naver.maps.Marker({
        position: point,
        map: naverMap,
        icon: {
          content: '<div style="width:14px;height:14px;border-radius:50%;background:#3182f6;border:3px solid #fff;box-shadow:0 0 0 2px rgba(49,130,246,0.4);"></div>',
          anchor: new naver.maps.Point(7, 7),
        },
      });

      try {
        const res = await fetch(`/api/nearby-places?lat=${latitude}&lng=${longitude}`);
        const data = await res.json();
        const names = (data.places || []).map((p) => p.name);
        if (names.length) applyRandomExamples(names);
      } catch {
        // 주변 가게 검색 실패 시 기존 예시 그대로 유지
      }
    },
    () => {
      // 위치 권한 거부/실패 — 기본 서울 중심 유지, 기존 전국 예시 리스트 그대로 사용
    },
    { timeout: 8000 },
  );
}

function placeMarker(lat, lng) {
  const point = new naver.maps.LatLng(lat, lng);
  naverMap.setCenter(point);
  naverMap.setZoom(17);
  if (naverMarker) naverMarker.setMap(null);
  naverMarker = new naver.maps.Marker({ position: point, map: naverMap });
}

function fillStoreInfo(address, storeName, extra) {
  mapResultInfo.textContent = `📍 ${address}${extra ? ` · ${extra}` : ''}`;
  if (storeName) storeNameInput.value = storeName;
}

function geocodeAddress(address) {
  return new Promise((resolve) => {
    naver.maps.Service.geocode({ query: address }, (status, response) => {
      const result = status === naver.maps.Service.Status.OK && response.v2.addresses[0];
      resolve(result ? { lat: parseFloat(result.y), lng: parseFloat(result.x) } : null);
    });
  });
}

// 네이버처럼 후보를 리스트로 보여주고, 클릭하면 지도+매장정보가 채워지는 방식
function renderResultList(candidates) {
  if (!candidates.length) {
    mapResultInfo.innerHTML = '검색 결과가 없어요. 주소나 매장명을 다시 확인해주세요.';
    return;
  }
  mapResultInfo.innerHTML = candidates
    .map((c, i) => `<button type="button" class="blog-candidate map-candidate" data-idx="${i}">${c.name ? `<b>${c.name}</b><br>` : ''}${c.address}${c.category ? ` · ${c.category}` : ''}</button>`)
    .join('');

  mapResultInfo.querySelectorAll('.map-candidate').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const c = candidates[Number(btn.dataset.idx)];
      const point = c.lat != null ? c : await geocodeAddress(c.address);
      if (!point) {
        mapResultInfo.innerHTML = '이 후보의 좌표를 못 찾았어요. 다른 후보를 선택해주세요.';
        return;
      }
      placeMarker(point.lat, point.lng);
      fillStoreInfo(c.address, c.name, c.category);
    });
  });
}

async function searchViaOsmFallback(query) {
  try {
    const res = await fetch(`/api/place-search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    const fallbackName = query.replace(/\s*(로|길|동|읍|면|시|군|구)\s.*$/, '').trim() || query;
    const candidates = (data.places || []).map((p) => ({
      name: fallbackName, address: p.address, lat: p.lat, lng: p.lng,
    }));
    renderResultList(candidates);
  } catch (err) {
    mapResultInfo.textContent = '검색 중 오류가 발생했어요. 매장명은 직접 입력해주세요.';
  }
}

function geocodeQueryAllCandidates(query) {
  return new Promise((resolve) => {
    naver.maps.Service.geocode({ query }, (status, response) => {
      const addresses = status === naver.maps.Service.Status.OK ? (response.v2.addresses || []) : [];
      const fallbackName = query.replace(/\s*(로|길|동|읍|면|시|군|구)\s.*$/, '').trim() || query;
      resolve(addresses.map((a) => ({
        name: fallbackName,
        address: a.roadAddress || a.jibunAddress || query,
        lat: parseFloat(a.y),
        lng: parseFloat(a.x),
      })));
    });
  });
}

// 1순위: 네이버 지역검색(상호명 전용, 키 필요) → 2순위: 네이버 지오코딩(주소 전용) → 3순위: OSM(키 불필요, 커버리지 낮음)
async function searchStoreOnMap() {
  // 아무것도 입력 안 하고 검색을 누르면, 회색 예시글자(placeholder)를 그대로 검색해줌
  let query = mapSearchInput.value.trim();
  if (!query && mapSearchInput.placeholder.startsWith('예: ')) {
    query = mapSearchInput.placeholder.replace(/^예:\s*/, '');
    mapSearchInput.value = query;
  }
  if (!query) return;
  if (naverMapAuthFailed) return; // 이미 안내 메시지 표시됨
  if (!naverMap || typeof naver === 'undefined' || !naver.maps.Service) {
    mapResultInfo.textContent = '지도 검색을 쓸 수 없어요. 매장명은 직접 입력해주세요.';
    return;
  }

  mapResultInfo.textContent = '검색 중...';

  try {
    const localRes = await fetch(`/api/naver-local-search?query=${encodeURIComponent(query)}`);
    const localData = await localRes.json();

    if (!localData.needsApiKey && localData.places && localData.places.length) {
      renderResultList(localData.places.map((p) => ({ name: p.name, address: p.address, category: p.category })));
      return;
    }
  } catch (err) {
    // 지역검색 실패 시 조용히 다음 단계로 진행
  }

  const geocodeCandidates = await geocodeQueryAllCandidates(query);
  if (geocodeCandidates.length) {
    renderResultList(geocodeCandidates);
    return;
  }

  await searchViaOsmFallback(query);
}

mapSearchBtn.addEventListener('click', searchStoreOnMap);
mapSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); searchStoreOnMap(); }
});

window.addEventListener('load', initNaverMap);

uploadBox.addEventListener('click', (e) => {
  if (e.target !== photoInput) photoInput.click();
});

photoInput.addEventListener('change', () => {
  selectedFiles = Array.from(photoInput.files).slice(0, 6);
  renderPreview();
});

function renderPreview() {
  previewRow.innerHTML = '';
  if (!selectedFiles.length) {
    uploadEmpty.hidden = false;
    return;
  }
  uploadEmpty.hidden = true;
  selectedFiles.forEach((file) => {
    const url = URL.createObjectURL(file);
    const el = file.type.startsWith('video/')
      ? Object.assign(document.createElement('video'), { src: url, muted: true })
      : Object.assign(document.createElement('img'), { src: url });
    previewRow.appendChild(el);
  });
}

function showError(msg) {
  errorBox.hidden = false;
  errorBox.textContent = msg;
  statusBox.hidden = true;
  generateBtn.disabled = false;
}

function setStatus(msg) {
  statusBox.hidden = false;
  statusText.textContent = msg;
}

generateBtn.addEventListener('click', async () => {
  errorBox.hidden = true;
  resultBox.hidden = true;

  const storeName = storeNameInput.value.trim();
  const introText = introTextInput.value.trim();

  if (!selectedFiles.length) return showError('사진을 1장 이상 올려주세요.');
  if (!storeName) return showError('매장명을 입력해주세요.');
  if (!introText) return showError('한 줄 소개를 입력해주세요.');

  generateBtn.disabled = true;
  posterArea.textContent = '준비 중...';
  reelsArea.textContent = '준비 중...';
  setStatus('AI가 홍보 문구를 쓰는 중...');

  try {
    const textRes = await fetch('/api/generate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName,
        category: '소상공인',
        features: introText,
        purpose: '신규 고객 유치',
      }),
    });
    const textData = await textRes.json();
    if (!textRes.ok) throw new Error(textData.error || '문구 생성 실패');

    const flyerLines = String(textData.flyer_text || '').split('\n').filter(Boolean);
    const headline = flyerLines[0] || storeName;
    const subtext = flyerLines.slice(1).join(' ') || introText;
    const caption = (textData.sns_captions && textData.sns_captions[0]) || introText;

    setStatus('포스터와 릴스를 동시에 만드는 중... (영상은 시간이 좀 더 걸려요)');
    resultBox.hidden = false;

    const posterPromise = generatePoster({ storeName, headline, subtext });
    const reelsPromise = generateReels({ caption, mood: moodSelect.value });

    await Promise.allSettled([posterPromise, reelsPromise]);
    statusBox.hidden = true;
  } catch (err) {
    showError(err.message || '알 수 없는 오류가 발생했습니다.');
  } finally {
    generateBtn.disabled = false;
  }
});

async function generatePoster({ storeName, headline, subtext }) {
  try {
    const fd = new FormData();
    fd.append('photo', selectedFiles[0]);
    fd.append('storeName', storeName);
    fd.append('headline', headline);
    fd.append('subtext', subtext);

    const res = await fetch('/api/poster', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '포스터 생성 실패');

    posterArea.innerHTML = `
      <img src="${data.url}" alt="포스터" />
      <a class="download-link" href="${data.url}" download>포스터 다운로드</a>
    `;
    addShareButton(posterArea, data.url, 'poster.png', 'image/png');
  } catch (err) {
    posterArea.textContent = `포스터 생성 실패: ${err.message}`;
  }
}

async function generateReels({ caption, mood }) {
  try {
    const fd = new FormData();
    selectedFiles.forEach((f) => fd.append('photos', f));
    fd.append('caption', caption);
    if (mood) fd.append('mood', mood);

    const res = await fetch('/api/reels', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '릴스 생성 실패');

    reelsArea.innerHTML = `
      <video src="${data.url}" controls playsinline></video>
      <a class="download-link" href="${data.url}" download>릴스 다운로드</a>
    `;
    addShareButton(reelsArea, data.url, 'reels.mp4', 'video/mp4');
  } catch (err) {
    reelsArea.textContent = `릴스 생성 실패: ${err.message}`;
  }
}

const webtoonBtn = document.getElementById('webtoonBtn');
const illustBtn = document.getElementById('illustBtn');
const comicArea = document.getElementById('comicArea');

async function generateComic(endpoint, label) {
  if (selectedFiles.length < 2) {
    comicArea.innerHTML = `<div class="blog-note">만화는 사진이 최소 2장 필요해요.</div>`;
    return;
  }
  comicArea.innerHTML = `<div class="blog-note">${label} 만드는 중... (일러스트 모드는 시간이 좀 더 걸려요)</div>`;
  webtoonBtn.disabled = true;
  illustBtn.disabled = true;

  try {
    const fd = new FormData();
    selectedFiles.forEach((f) => fd.append('photos', f));
    fd.append('storeName', storeNameInput.value.trim());
    fd.append('captions', JSON.stringify([introTextInput.value.trim()]));

    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const data = await res.json();

    if (data.needsApiKey) {
      comicArea.innerHTML = `<div class="blog-note">${data.message}</div>`;
      return;
    }
    if (!res.ok) throw new Error(data.error || `${label} 생성 실패`);

    comicArea.innerHTML = `<img src="${data.url}" alt="${label}" /><a class="download-link" href="${data.url}" download>${label} 다운로드</a>`;
    addShareButton(comicArea, data.url, 'comic.png', 'image/png');
  } catch (err) {
    comicArea.innerHTML = `<div class="blog-note">${label} 생성 실패: ${err.message}</div>`;
  } finally {
    webtoonBtn.disabled = false;
    illustBtn.disabled = false;
  }
}

webtoonBtn.addEventListener('click', () => generateComic('/api/webtoon', '포토툰'));
illustBtn.addEventListener('click', () => generateComic('/api/illustration-comic', 'AI 일러스트 만화'));

// Web Share API — 네이티브 공유 시트로 인스타그램 등에 바로 공유 (API 심사 불필요)
async function addShareButton(container, url, filename, mimeType) {
  if (!navigator.share) return; // 데스크톱 등 미지원 브라우저는 다운로드 링크만 유지

  const btn = document.createElement('button');
  btn.className = 'share-link';
  btn.textContent = '📤 공유하기 (인스타 등)';
  btn.addEventListener('click', async () => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: mimeType });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '바쁜 소상공인들을 위한 마케팅 선물세트' });
      } else {
        await navigator.share({ url: window.location.origin + url });
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('share error:', err);
    }
  });
  container.appendChild(btn);
}
