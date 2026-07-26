// sharp(libvips)는 텍스트/SVG 렌더링에 fontconfig를 쓰는데, 배포 환경(Render)과 일부 로컬 환경엔
// 시스템 fontconfig 기본 설정(/etc/fonts/fonts.conf)이 아예 없어서 "Cannot load default config file"
// 에러와 함께 한글이 다 깨져버린다 (SVG 안에 폰트를 data URI로 박아 넣어도 마찬가지).
// 그래서 우리 폰트 폴더만 가리키는 최소 fonts.conf를 직접 만들어 FONTCONFIG_FILE로 지정한다.
// sharp를 최초로 사용하기 전에 반드시 이 모듈이 먼저 로드되어야 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FONTS_DIR = path.join(__dirname, 'fonts');
const CACHE_DIR = path.join(os.tmpdir(), 'hanul-fontconfig-cache');
const CONF_PATH = path.join(os.tmpdir(), 'hanul-fonts.conf');

fs.mkdirSync(CACHE_DIR, { recursive: true });

fs.writeFileSync(
  CONF_PATH,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONTS_DIR}</dir>
  <cachedir>${CACHE_DIR}</cachedir>
</fontconfig>
`,
);

process.env.FONTCONFIG_FILE = CONF_PATH;
