// kinetic 스타일의 수치를 한곳에 모아둔 곳.
// 자막 위치나 속도를 바꾸려면 여기만 고치면 된다 — docs/reel-style-kinetic.md 와 짝이다.

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

// 인스타그램 UI가 가리는 영역(2025년 말 기준으로 하단이 넓어졌다)
export const SAFE = { top: 200, bottom: 400, side: 96 };

// 자막 기준선은 바닥에서 480px — 하단 설명/오디오 표시줄을 피하는 높이
export const CAPTION_BASELINE = 480;
export const HOOK_CENTER_Y = 820;

export const DUR = {
  hook: 60, // 2.0초
  photo: 72, // 사진 한 장당 2.4초
  closing: 78, // 2.6초
  transition: 8, // 컷 전환 0.27초
  captionDelay: 6, // 자막은 컷 전환보다 6프레임 늦게 들어온다(박자 어긋내기)
  captionIn: 14,
};

export const COLORS = {
  text: '#FFFFFF',
  highlight: '#FFE14D',
  // 그림자를 두 겹으로 준다. 가까운 그림자가 글자 경계를 잡고, 먼 그림자가 배경을 눌러준다.
  // 한 겹만 흐리게 주면 밝은 음식 사진 위에서 글자가 번져 보인다.
  shadow: '0 2px 10px rgba(0, 0, 0, 0.9), 0 6px 30px rgba(0, 0, 0, 0.55)',
  overlay: 'rgba(0, 0, 0, 0.52)',
};

export const TYPE = {
  hook: 92,
  caption: 60,
  store: 104,
  address: 36,
};

export const FONT_FAMILY = 'NotoSansKRKinetic';

// 사진 장수에 따라 전체 길이가 정해진다.
export function totalFrames(photoCount) {
  const n = Math.max(1, photoCount || 1);
  return DUR.hook + n * DUR.photo + DUR.closing;
}
