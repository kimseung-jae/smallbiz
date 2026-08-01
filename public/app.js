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
const nearbyRecoArea = document.getElementById('nearbyRecoArea');
const webImageBtn = document.getElementById('webImageBtn');
const webImageArea = document.getElementById('webImageArea');

// 서버가 타임아웃/과부하로 죽으면 Render가 JSON 대신 자체 HTML 에러 페이지를 돌려줘서
// res.json()이 "Unexpected token '<'"로 깨지는 문제 — 미리 텍스트로 받아서 안전하게 파싱하고,
// 실패하면 사용자가 이해할 수 있는 한국어 에러 메시지로 바꿔서 던진다.
async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('서버가 잠시 바빠요. 몇 초 후 다시 시도해주세요.');
  }
}

async function fetchBlogSuggestions(storeName) {
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
    const data = await parseJsonSafe(res);

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

    const combinedHtml = data.combined
      ? `<button type="button" class="blog-candidate blog-candidate-combined" data-combined="1">✨ 종합해서 자동으로: ${data.combined}</button>`
      : '';

    blogCandidates.innerHTML = combinedHtml + candidates
      .map((c, i) => `<button type="button" class="blog-candidate" data-idx="${i}">${i + 1}. ${c}</button>`)
      .join('') + '<div class="blog-note">마음에 드는 걸 탭하면 아래 소개글에 채워져요. 직접 수정도 가능해요.</div>';

    if (data.combined) {
      blogCandidates.querySelector('.blog-candidate-combined').addEventListener('click', () => {
        introTextInput.value = data.combined;
      });
    }
    blogCandidates.querySelectorAll('.blog-candidate:not(.blog-candidate-combined)').forEach((btn) => {
      btn.addEventListener('click', () => {
        introTextInput.value = candidates[Number(btn.dataset.idx)];
      });
    });
  } catch (err) {
    blogCandidates.innerHTML = `<div class="blog-note">오류: ${err.message}</div>`;
  } finally {
    fetchBlogBtn.disabled = false;
  }
}

fetchBlogBtn.addEventListener('click', () => fetchBlogSuggestions(storeNameInput.value.trim()));

function escapeHtmlClient(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "■ 섹션제목" 마커로 나뉜 블로그 원고 텍스트를 섹션별 카드 형태로 예쁘게 렌더링
function formatBlogBody(body) {
  const lines = String(body || '').split('\n');
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^■\s*(.+)$/);
    if (sectionMatch) {
      current = { title: sectionMatch[1], paragraphs: [] };
      sections.push(current);
    } else if (line) {
      if (!current) {
        current = { title: null, paragraphs: [] };
        sections.push(current);
      }
      current.paragraphs.push(line);
    }
  }

  return sections
    .map((s) => `
      <div class="blog-section">
        ${s.title ? `<div class="blog-section-title">${escapeHtmlClient(s.title)}</div>` : ''}
        ${s.paragraphs.map((p) => `<p class="blog-section-p">${escapeHtmlClient(p)}</p>`).join('')}
      </div>
    `)
    .join('');
}

const blogPostBtn = document.getElementById('blogPostBtn');
const blogPostArea = document.getElementById('blogPostArea');

blogPostBtn.addEventListener('click', async () => {
  const storeName = storeNameInput.value.trim();
  if (!storeName) {
    blogPostArea.innerHTML = '<div class="blog-note">매장명을 먼저 입력해주세요.</div>';
    return;
  }

  blogPostBtn.disabled = true;
  blogPostArea.innerHTML = '<div class="blog-note">블로그 원고 쓰는 중...</div>';

  try {
    const res = await fetch('/api/blog-post-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName,
        category: '소상공인',
        features: introTextInput.value.trim(),
        address: selectedStoreAddress,
      }),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || '블로그 원고 생성 실패');

    blogPostArea.innerHTML = `
      <div class="blog-post-card">
        <h4>${escapeHtmlClient(data.title || '')}</h4>
        <div id="blogPostBody">${formatBlogBody(data.body || '')}</div>
        <button type="button" class="secondary-btn" id="copyBlogPostBtn">📋 전체 복사하기</button>
      </div>
    `;
    document.getElementById('copyBlogPostBtn').addEventListener('click', async (e) => {
      await navigator.clipboard.writeText(`${data.title || ''}\n\n${data.body || ''}`);
      e.target.textContent = '✅ 복사됨!';
      setTimeout(() => { e.target.textContent = '📋 전체 복사하기'; }, 1500);
    });
  } catch (err) {
    blogPostArea.innerHTML = `<div class="blog-note">오류: ${err.message}</div>`;
  } finally {
    blogPostBtn.disabled = false;
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

let userLocation = null; // {lat, lng} — 한 번 받아오면 캐시해서 재사용

// GPS/IP 위치를 끝내 못 잡으면 최종적으로 쓸 기본 위치 (강화군청 부근).
// TODO: 여러 지역 사장님이 쓰게 되면 매장별로 설정 가능하게 바꿔야 함 — 지금은 단일 매장 테스트용 기본값.
const FALLBACK_LOCATION = { lat: 37.7461, lng: 126.4868 };

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
    useMyLocation();
  } catch (err) {
    mapResultInfo.textContent = '지도를 불러오지 못했어요. 매장명/한 줄 소개는 아래에서 직접 입력해주세요.';
  }
}

// 내 위치를 한 번 받아오면 캐시해서 재사용 — "매장 위치 찾기"는 항상 이 위치를 기준으로 실행됨
function placeUserLocationMarker(lat, lng) {
  const point = new naver.maps.LatLng(lat, lng);
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
}

// GPS를 끝내 못 잡으면(권한 거부/시간초과/네트워크 문제 등) IP 기반 위치는 통신사 게이트웨이 위치로
// 잘못 잡히는 경우가 많아(예: 강화도에 있어도 송파구로 나옴) 신뢰하지 않고, 바로 기본 위치로 대체한다.
function useFallbackLocation(reasonText) {
  userLocation = { ...FALLBACK_LOCATION };
  placeUserLocationMarker(userLocation.lat, userLocation.lng);
  mapResultInfo.textContent = `📍 ${reasonText} 기본 위치로 표시할게요. 정확한 매장 위치는 위 검색창에서 직접 찾아 선택해주세요.`;
  return userLocation;
}

function getUserLocation() {
  if (userLocation) return Promise.resolve(userLocation);

  // 위치 정보 API는 localhost 또는 https에서만 동작함 — IP주소(http://192.168.x.x)로 접속하면
  // 브라우저가 권한 요청 자체를 차단하므로, 왜 안 되는지 화면에 바로 알려준다.
  const isSecureContext = window.isSecureContext;
  if (!isSecureContext) {
    return Promise.resolve(useFallbackLocation('이 주소(http)는 보안 연결이 아니라서 위치 정보를 쓸 수 없어요.'));
  }
  if (!navigator.geolocation) {
    return Promise.resolve(useFallbackLocation('이 브라우저는 위치 정보를 지원하지 않아요.'));
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        userLocation = { lat: latitude, lng: longitude };
        placeUserLocationMarker(latitude, longitude);
        resolve(userLocation);
      },
      (err) => {
        const reasons = {
          1: '위치 권한이 거부됐어요.',
          2: '위치를 확인할 수 없어요 (GPS/네트워크 문제).',
          3: '위치 확인이 시간 초과됐어요.',
        };
        resolve(useFallbackLocation(reasons[err.code] || '위치 정보를 가져오지 못했어요.'));
      },
      { timeout: 20000, maximumAge: 60000 }, // 맥/데스크톱은 GPS가 없어 와이파이 기반 위치 계산이 느릴 수 있어 넉넉히 잡음
    );
  });
}

// 페이지 로드 시 자동으로 한 번 시도하고, "내 위치로 보기" 버튼으로 언제든 다시 시도 가능
async function useMyLocation() {
  const loc = await getUserLocation();
  if (loc) {
    fetchNearbyExamples(loc);
    showNearbyRecommendations(loc);
  }
}

const useMyLocationBtn = document.getElementById('useMyLocationBtn');
useMyLocationBtn.addEventListener('click', () => {
  userLocation = null; // 버튼 누르면 캐시된 실패 상태 무시하고 무조건 다시 요청
  mapResultInfo.textContent = '내 위치 확인 중...';
  useMyLocation();
});

// 카카오(신청 필요)와 오버패스(무료, 키 불필요) 둘 다 호출해서 합치고 중복 제거 —
// 한쪽이 실패하거나 키가 없어도 나머지 결과로 예시를 채움
async function fetchNearbyExamples(loc) {
  try {
    const [kakaoRes, osmRes] = await Promise.allSettled([
      fetch(`/api/kakao-nearby?lat=${loc.lat}&lng=${loc.lng}`).then((r) => r.json()),
      fetch(`/api/nearby-places?lat=${loc.lat}&lng=${loc.lng}`).then((r) => r.json()),
    ]);

    const names = new Set();
    if (kakaoRes.status === 'fulfilled' && !kakaoRes.value.needsApiKey) {
      (kakaoRes.value.places || []).forEach((p) => names.add(p.name));
    }
    if (osmRes.status === 'fulfilled') {
      (osmRes.value.places || []).forEach((p) => names.add(p.name));
    }

    if (names.size) applyRandomExamples([...names]);
  } catch {
    // 주변 가게 검색 실패 시 기존 예시 그대로 유지
  }
}

// 첫 화면에 내 주변 추천 10곳을 바로 보여줌 — sort=accuracy(관련도순)를 "유명한 순"의 근사치로 사용
// (카카오/네이버 무료 API엔 실제 리뷰수·평점 기반 인기 정렬이 없음)
async function showNearbyRecommendations(loc) {
  try {
    const res = await fetch(`/api/kakao-nearby?lat=${loc.lat}&lng=${loc.lng}&sort=accuracy`);
    const data = await parseJsonSafe(res);
    if (data.needsApiKey) return;

    const topN = (data.places || []).slice(0, 10);
    if (!topN.length) return;

    nearbyRecoArea.innerHTML =
      '<div class="nearby-reco-title">📍 내 주변 추천</div>' +
      topN
        .map((p, i) => `
          <button type="button" class="nearby-reco-card" data-idx="${i}">
            <span class="nearby-reco-rank">${i + 1}</span>
            <span class="nearby-reco-body"><b>${p.name}</b><span class="nearby-reco-meta">${p.category || ''} · ${p.address || ''}</span></span>
          </button>
        `)
        .join('');

    nearbyRecoArea.querySelectorAll('.nearby-reco-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = topN[Number(btn.dataset.idx)];
        fillStoreInfo(p.address, p.name, p.category);
        placeMarker(p.lat, p.lng);
        userLocation = { lat: p.lat, lng: p.lng };
        fetchBlogSuggestions(p.name);
      });
    });
  } catch {
    // 추천 목록을 못 가져와도 검색 기능엔 지장 없음
  }
}

function placeMarker(lat, lng) {
  const point = new naver.maps.LatLng(lat, lng);
  naverMap.setCenter(point);
  naverMap.setZoom(17);
  if (naverMarker) naverMarker.setMap(null);
  naverMarker = new naver.maps.Marker({ position: point, map: naverMap });
}

let selectedStoreAddress = '';
let selectedStoreCategory = '';

function fillStoreInfo(address, storeName, extra) {
  mapResultInfo.textContent = `📍 ${address}${extra ? ` · ${extra}` : ''}`;
  if (storeName) storeNameInput.value = storeName;
  selectedStoreAddress = address || '';
  selectedStoreCategory = extra || '';
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
      // 매장명/주소는 지도 핀 좌표 확보 여부와 무관하게 항상 먼저 채운다 —
      // 좌표를 못 찾아도(지오코딩 실패) 매장 정보 입력까지 막히면 안 됨
      fillStoreInfo(c.address, c.name, c.category);

      // 매장을 고르면 블로그 후기 기반 소개글도 자동으로 같이 가져옴
      if (c.name) fetchBlogSuggestions(c.name);

      const point = c.lat != null ? c : await geocodeAddress(c.address);
      if (point) {
        placeMarker(point.lat, point.lng);
        // 실제 매장을 골랐으면 그 위치가 GPS/IP 추정보다 훨씬 정확함 — "내 위치"를 이걸로 덮어써서
        // 이후 주변 추천 등이 엉뚱한 IP 기반 위치(예: 송파구)로 안 돌아가게 함
        userLocation = { lat: point.lat, lng: point.lng };
        fetchNearbyExamples(userLocation);
        showNearbyRecommendations(userLocation);
      }
    });
  });
}

async function searchViaOsmFallback(query) {
  try {
    const res = await fetch(`/api/place-search?query=${encodeURIComponent(query)}`);
    const data = await parseJsonSafe(res);
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

// 매장 위치 찾기는 항상 내 위치를 먼저 받은 뒤, 네이버 지역검색 + 카카오 키워드검색을 동시에 돌려서 합친다.
// 결과가 없으면 네이버 지오코딩(주소) → OSM(무료, 최후 수단) 순으로 대체.
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

  mapResultInfo.textContent = '내 위치 확인 중...';
  const loc = await getUserLocation(); // 무조건 먼저 내 위치를 받고 시작 (거부되면 null, 전국 기준으로 대체)

  mapResultInfo.textContent = '검색 중...';

  const locParam = loc ? `&lat=${loc.lat}&lng=${loc.lng}` : '';
  const [naverRes, kakaoRes] = await Promise.allSettled([
    fetch(`/api/naver-local-search?query=${encodeURIComponent(query)}`).then((r) => r.json()),
    fetch(`/api/kakao-search?query=${encodeURIComponent(query)}${locParam}`).then((r) => r.json()),
  ]);

  const merged = [];
  const seen = new Set();

  if (naverRes.status === 'fulfilled' && !naverRes.value.needsApiKey) {
    for (const p of naverRes.value.places || []) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      merged.push({ name: p.name, address: p.address, category: p.category });
    }
  }
  if (kakaoRes.status === 'fulfilled' && !kakaoRes.value.needsApiKey) {
    for (const p of kakaoRes.value.places || []) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      merged.push({ name: p.name, address: p.address, category: p.category, lat: p.lat, lng: p.lng });
    }
  }

  if (merged.length) {
    renderResultList(merged);
    return;
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
  // 사진 선택창을 여러 번 열어서 한 장씩 골라도 이전에 고른 사진이 사라지지 않도록 누적함
  // (브라우저 기본 동작은 매번 새로 고른 파일로 통째로 교체해버림)
  const newFiles = Array.from(photoInput.files);
  const isDuplicate = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  for (const file of newFiles) {
    if (!selectedFiles.some((f) => isDuplicate(f, file))) selectedFiles.push(file);
  }
  selectedFiles = selectedFiles.slice(0, 6);
  photoInput.value = ''; // 같은 파일을 다시 선택해도 change 이벤트가 발생하도록 초기화
  renderPreview();
});

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  renderPreview();
}

function renderPreview() {
  previewRow.innerHTML = '';
  if (!selectedFiles.length) {
    uploadEmpty.hidden = false;
    return;
  }
  uploadEmpty.hidden = true;
  selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    const el = file.type.startsWith('video/')
      ? Object.assign(document.createElement('video'), { src: url, muted: true })
      : Object.assign(document.createElement('img'), { src: url });

    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb';
    wrap.appendChild(el);

    if (i === 0) {
      const badge = document.createElement('div');
      badge.className = 'preview-cover-badge';
      badge.textContent = '대표';
      wrap.appendChild(badge);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeSelectedFile(i);
    });
    wrap.appendChild(removeBtn);

    previewRow.appendChild(wrap);
  });
}

// 여러 후보 이미지를 그리드로 그리고, 클릭하면 업로드 사진처럼 selectedFiles에 추가하는 공통 로직
function renderImageResults(container, images, creditText) {
  if (!images.length) {
    container.innerHTML = '<div class="blog-note">관련 이미지를 찾지 못했어요.</div>';
    return;
  }

  container.innerHTML = images
    .map((img, i) => `<div class="web-image-item" data-idx="${i}"><img src="${img.thumbnailUrl}" loading="lazy" /><span class="check">✓</span></div>`)
    .join('') + (creditText ? `<div class="image-credit">${creditText}</div>` : '');

  container.querySelectorAll('.web-image-item').forEach((el) => {
    el.addEventListener('click', async () => {
      if (selectedFiles.length >= 6) {
        container.insertAdjacentHTML('beforeend', '<div class="blog-note">사진은 최대 6장까지예요.</div>');
        return;
      }
      const img = images[Number(el.dataset.idx)];
      el.classList.add('selected');
      try {
        const proxyRes = await fetch(`/api/image-proxy?url=${encodeURIComponent(img.imageUrl)}`);
        if (!proxyRes.ok) throw new Error('이미지를 가져오지 못했어요');
        const blob = await proxyRes.blob();
        const file = new File([blob], `web-image-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
        selectedFiles.push(file);
        selectedFiles = selectedFiles.slice(0, 6);
        renderPreview();
      } catch (err) {
        el.classList.remove('selected');
        container.insertAdjacentHTML('beforeend', `<div class="blog-note">추가 실패: ${err.message}</div>`);
      }
    });
  });
}

// 실제 웹 이미지 — 네이버 + 다음 이미지 검색을 매장명 기준으로 동시 호출해서 합침
const realImageTabs = document.getElementById('realImageTabs');
let realImageResults = { naver: [], daum: [], google: [] };
let activeRealImageTab = 'naver';
const REAL_IMAGE_TAB_LABEL = { naver: '네이버', daum: '다음', google: '구글' };

function renderActiveRealImageTab(query) {
  const images = realImageResults[activeRealImageTab] || [];
  const label = REAL_IMAGE_TAB_LABEL[activeRealImageTab] || activeRealImageTab;
  renderImageResults(realImageArea, images, `${label} "${query}" 검색 결과 · 실제 매장 사진이 아닐 수 있어요`);
}

realImageTabs.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    realImageTabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeRealImageTab = btn.dataset.tab;
    renderActiveRealImageTab(realImageBtn.dataset.lastQuery || storeNameInput.value.trim());
  });
});

realImageBtn.addEventListener('click', async () => {
  const storeName = storeNameInput.value.trim();
  if (!storeName) {
    realImageArea.innerHTML = '<div class="blog-note">매장명을 먼저 입력해주세요.</div>';
    return;
  }
  // 주소가 있으면 지역명을 붙여서 검색어를 더 구체적으로 만듦 (관련도 향상)
  const regionHint = selectedStoreAddress ? selectedStoreAddress.split(' ').slice(0, 2).join(' ') : '';
  const query = regionHint ? `${storeName} ${regionHint}` : storeName;
  realImageBtn.dataset.lastQuery = query;

  realImageBtn.disabled = true;
  realImageTabs.hidden = true;
  realImageArea.innerHTML = '<div class="blog-note">이미지 찾는 중...</div>';

  try {
    const [naverRes, daumRes, googleRes] = await Promise.allSettled([
      fetch(`/api/image-search?query=${encodeURIComponent(query)}`).then((r) => r.json()),
      fetch(`/api/daum-image-search?query=${encodeURIComponent(query)}`).then((r) => r.json()),
      fetch(`/api/google-image-search?query=${encodeURIComponent(query)}`).then((r) => r.json()),
    ]);

    realImageResults.naver = (naverRes.status === 'fulfilled' && !naverRes.value.needsApiKey) ? (naverRes.value.images || []) : [];
    realImageResults.daum = (daumRes.status === 'fulfilled' && !daumRes.value.needsApiKey) ? (daumRes.value.images || []) : [];
    realImageResults.google = (googleRes.status === 'fulfilled' && !googleRes.value.needsApiKey) ? (googleRes.value.images || []) : [];

    realImageTabs.hidden = false;
    activeRealImageTab = 'naver';
    realImageTabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'naver'));
    renderActiveRealImageTab(query);
  } catch (err) {
    realImageArea.innerHTML = `<div class="blog-note">오류: ${err.message}</div>`;
  } finally {
    realImageBtn.disabled = false;
  }
});

// 스톡사진 — Pexels(카테고리/분위기 기준, 고품질)
async function searchStockImages(query) {
  webImageBtn && (webImageBtn.disabled = true);
  webImageArea.innerHTML = '<div class="blog-note">이미지 찾는 중...</div>';

  try {
    const res = await fetch(`/api/pexels-search?query=${encodeURIComponent(query)}`);
    const data = await parseJsonSafe(res);

    if (data.needsApiKey) {
      webImageArea.innerHTML = `<div class="blog-note">${data.message}</div>`;
      return;
    }
    if (!res.ok) throw new Error(data.error || '이미지 검색 실패');

    renderImageResults(webImageArea, data.images || [], '사진: Pexels · 실제 매장 사진이 아닌 분위기 참고용 스톡사진입니다');
  } catch (err) {
    webImageArea.innerHTML = `<div class="blog-note">오류: ${err.message}</div>`;
  } finally {
    webImageBtn && (webImageBtn.disabled = false);
  }
}

document.querySelectorAll('.category-chip:not(.category-chip-smart)').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.category-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    searchStockImages(chip.dataset.q);
  });
});

// 매장 카테고리/이름/소개글에서 키워드를 찾아 어울리는 영어 스톡사진 검색어로 매핑
// (Pexels는 영어 검색이 훨씬 정확해서, 한글 업종명을 영어로 번역해주는 역할)
const CATEGORY_KEYWORD_MAP = [
  [['피자'], 'pizza restaurant'],
  [['치킨', '통닭'], 'fried chicken'],
  [['커피', '카페', '카훼'], 'cozy cafe coffee'],
  [['베이커리', '빵', '제과', '디저트', '케이크'], 'bakery dessert'],
  [['고기', '삼겹살', '갈비', '구이', '정육'], 'korean bbq grill meat'],
  [['횟집', '해물', '생선', '수산', '회'], 'fresh seafood sashimi'],
  [['초밥', '스시', '일식', '라멘', '돈카츠'], 'japanese sushi ramen'],
  [['중식', '짜장', '짬뽕', '중국'], 'chinese food'],
  [['분식', '떡볶이', '김밥'], 'korean street food tteokbokki'],
  [['국밥', '설렁탕', '해장국', '한식', '백반'], 'korean traditional restaurant'],
  [['냉면', '면', '국수'], 'korean noodles'],
  [['술집', '포차', '호프', '펍', '바'], 'bar pub night'],
  [['꽃', '플라워'], 'flower shop florist'],
  [['미용실', '헤어', '뷰티'], 'hair salon beauty'],
  [['카센터', '정비', '자동차'], 'car repair garage'],
  [['편의점', '마트'], 'convenience store'],
];

function detectStockCategoryQuery() {
  const text = `${selectedStoreCategory} ${storeNameInput.value} ${introTextInput.value}`;
  for (const [keywords, query] of CATEGORY_KEYWORD_MAP) {
    if (keywords.some((k) => text.includes(k))) return query;
  }
  return 'restaurant food'; // 매칭 안 되면 일반 음식점 느낌으로 기본값
}

const smartCategoryChip = document.getElementById('smartCategoryChip');
smartCategoryChip.addEventListener('click', () => {
  document.querySelectorAll('.category-chip').forEach((c) => c.classList.remove('active'));
  smartCategoryChip.classList.add('active');
  searchStockImages(detectStockCategoryQuery());
});

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
    const textData = await parseJsonSafe(textRes);
    if (!textRes.ok) throw new Error(textData.error || '문구 생성 실패');

    const flyerLines = String(textData.flyer_text || '').split('\n').filter(Boolean);
    const headline = flyerLines[0] || storeName;
    const subtext = flyerLines.slice(1).join(' ') || introText;
    const caption = (textData.sns_captions && textData.sns_captions[0]) || introText;

    setStatus('포스터와 릴스를 동시에 만드는 중... (영상은 시간이 좀 더 걸려요)');
    resultBox.hidden = false;

    const posterPromise = generatePoster({ storeName, headline, subtext, address: selectedStoreAddress });
    const reelsPromise = generateReels({ caption, mood: moodSelect.value });

    await Promise.allSettled([posterPromise, reelsPromise]);
    statusBox.hidden = true;
  } catch (err) {
    showError(err.message || '알 수 없는 오류가 발생했습니다.');
  } finally {
    generateBtn.disabled = false;
  }
});

async function generatePoster({ storeName, headline, subtext, address }) {
  posterArea.innerHTML = '<div class="spinner"></div><div class="blog-note">포스터 만드는 중... (첫 요청은 서버가 깨어나는 데 시간이 좀 더 걸릴 수 있어요)</div>';
  try {
    const fd = new FormData();
    fd.append('photo', selectedFiles[0]);
    fd.append('storeName', storeName);
    fd.append('headline', headline);
    fd.append('subtext', subtext);
    if (address) fd.append('address', address);

    const res = await fetch('/api/poster', { method: 'POST', body: fd });
    const data = await parseJsonSafe(res);
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
    const data = await parseJsonSafe(res);
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

const reviewInput = document.getElementById('reviewInput');
const reviewReplyBtn = document.getElementById('reviewReplyBtn');
const reviewReplyArea = document.getElementById('reviewReplyArea');

// 실제 리뷰 API는 없으니, 사장님이 형식을 바로 감 잡을 수 있도록 그럴듯한 예시 리뷰를 랜덤으로 채워둠
// (버튼 누르면 입력 없어도 이 예시로 바로 결과를 보여줘서 "써보고 이해하는" 방식)
const SAMPLE_REVIEWS = [
  '사장님이 친절하시고 음식도 정갈해요! 또 올게요',
  '맛있어요 근데 배달이 좀 늦었어요',
  '가격 대비 양이 많아서 만족스러웠습니다',
  '분위기 좋고 사진 찍기도 예뻐요 인생샷 건졌어요',
  '오래 기다렸는데 맛은 그저 그랬어요',
  '단골 됐어요 항상 친절하게 응대해주셔서 감사합니다',
  '재료가 신선하고 정성이 느껴지는 맛이었어요',
];
reviewInput.placeholder = `예: ${SAMPLE_REVIEWS[Math.floor(Math.random() * SAMPLE_REVIEWS.length)]}`;

reviewReplyBtn.addEventListener('click', async () => {
  let review = reviewInput.value.trim();
  if (!review && reviewInput.placeholder.startsWith('예: ')) {
    review = reviewInput.placeholder.replace(/^예:\s*/, '');
    reviewInput.value = review;
  }
  if (!review) {
    reviewReplyArea.innerHTML = '<div class="blog-note">리뷰 내용을 먼저 붙여넣어 주세요.</div>';
    return;
  }

  reviewReplyBtn.disabled = true;
  reviewReplyArea.innerHTML = '<div class="blog-note">답글 쓰는 중...</div>';

  try {
    const res = await fetch('/api/review-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeName: storeNameInput.value.trim(), review }),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || '답글 생성 실패');

    const replies = data.replies || [];
    if (!replies.length) {
      reviewReplyArea.innerHTML = '<div class="blog-note">답글을 만들지 못했어요. 다시 시도해주세요.</div>';
      return;
    }

    reviewReplyArea.innerHTML = replies
      .map((r, i) => `
        <div class="blog-candidate" style="cursor:default;">
          ${r}
          <button type="button" class="secondary-btn copy-reply-btn" data-idx="${i}" style="margin-top:8px;">📋 복사하기</button>
        </div>
      `)
      .join('');

    reviewReplyArea.querySelectorAll('.copy-reply-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(replies[Number(btn.dataset.idx)]);
        btn.textContent = '✅ 복사됨!';
        setTimeout(() => { btn.textContent = '📋 복사하기'; }, 1500);
      });
    });
  } catch (err) {
    reviewReplyArea.innerHTML = `<div class="blog-note">오류: ${err.message}</div>`;
  } finally {
    reviewReplyBtn.disabled = false;
  }
});

const webtoonBtn = document.getElementById('webtoonBtn');
const comicArea = document.getElementById('comicArea');
const cardNewsBtn = document.getElementById('cardNewsBtn');
const cardNewsArea = document.getElementById('cardNewsArea');
async function generateComic(endpoint, label) {
  if (selectedFiles.length < 2) {
    comicArea.innerHTML = `<div class="blog-note">만화는 사진이 최소 2장 필요해요.</div>`;
    return;
  }
  comicArea.innerHTML = `<div class="blog-note">${label} 만드는 중...</div>`;
  webtoonBtn.disabled = true;

  try {
    const fd = new FormData();
    selectedFiles.forEach((f) => fd.append('photos', f));
    fd.append('storeName', storeNameInput.value.trim());
    fd.append('captions', JSON.stringify([introTextInput.value.trim()]));

    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const data = await parseJsonSafe(res);

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
  }
}

webtoonBtn.addEventListener('click', () => generateComic('/api/webtoon', '포토툰'));

cardNewsBtn.addEventListener('click', async () => {
  if (!selectedFiles.length) {
    cardNewsArea.innerHTML = '<div class="blog-note">사진을 1장 이상 올려주세요.</div>';
    return;
  }
  const storeName = storeNameInput.value.trim();
  const introText = introTextInput.value.trim();
  if (!storeName) {
    cardNewsArea.innerHTML = '<div class="blog-note">매장명을 먼저 입력해주세요.</div>';
    return;
  }

  cardNewsBtn.disabled = true;
  cardNewsArea.innerHTML = '<div class="blog-note">카드뉴스 만드는 중...</div>';

  try {
    // 슬라이드별 문구는 타이핑 없이 한 줄 소개에서 자동으로 나눠서 채움 —
    // 사진 수보다 문구 조각이 부족하면 그냥 비워둬서 같은 말이 반복되지 않게 함
    const parts = introText ? introText.split(/[,·]/).map((s) => s.trim()).filter(Boolean) : [];
    const captions = selectedFiles.map((_, i) => {
      if (i === 0) return introText;
      return parts[i - 1] || '';
    });

    const fd = new FormData();
    selectedFiles.forEach((f) => fd.append('photos', f));
    fd.append('storeName', storeName);
    fd.append('headline', captions[0] || introText || storeName);
    fd.append('address', selectedStoreAddress);
    fd.append('captions', JSON.stringify(captions));

    const res = await fetch('/api/card-news', { method: 'POST', body: fd });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || '카드뉴스 생성 실패');

    const urls = data.urls || [];
    cardNewsArea.innerHTML = urls
      .map((url, i) => `
        <div class="card-news-slide">
          <img src="${url}" alt="카드뉴스 ${i + 1}" />
          <a class="download-link" href="${url}" download>${i + 1}장 다운로드</a>
        </div>
      `)
      .join('');
  } catch (err) {
    cardNewsArea.innerHTML = `<div class="blog-note">카드뉴스 생성 실패: ${err.message}</div>`;
  } finally {
    cardNewsBtn.disabled = false;
  }
});

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
        await navigator.share({ files: [file], title: '소상공인 딸깍!' });
      } else {
        await navigator.share({ url: window.location.origin + url });
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('share error:', err);
    }
  });
  container.appendChild(btn);
}
