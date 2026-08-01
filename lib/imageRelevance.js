// 검색어와 무관해 보이는 결과(제목에 매장명/키워드가 하나도 안 겹치는 것)와
// 너무 작은 이미지(아이콘/로고성 썸네일)를 걸러내서 관련도를 높인다.
// title이 없는 소스(예: 다음 이미지 검색)는 크기 필터만 적용된다.
function filterRelevantImages(images, query) {
  const tokens = String(query || '').split(/\s+/).filter((t) => t.length >= 2);

  const bigEnough = (img) => !img.width || !img.height || (Number(img.width) >= 200 && Number(img.height) >= 200);
  const sizeFiltered = images.filter(bigEnough);

  if (!tokens.length) return sizeFiltered;

  const relevant = sizeFiltered.filter((img) => tokens.some((t) => (img.title || '').includes(t)));
  return relevant.length ? relevant : sizeFiltered;
}

module.exports = { filterRelevantImages };
