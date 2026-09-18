import { useEffect, useState } from 'react';
import { delayRender, continueRender, staticFile } from 'remotion';
import { FONT_FAMILY } from '../theme';

// 폰트가 로딩되기 전에 프레임을 그리면 글자가 기본 서체로 찍히거나 아예 빠진다.
// delayRender 로 렌더를 붙잡아 두고, 로딩이 끝난 뒤에 놓아준다.
export function useKineticFont() {
  const [handle] = useState(() => delayRender('kinetic-font'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const face = new FontFace(
      FONT_FAMILY,
      `url(${staticFile('NotoSansKR-VF.ttf')}) format('truetype')`,
      { weight: '100 900' }
    );

    face
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        return document.fonts.ready;
      })
      .then(() => {
        if (cancelled) return;
        setReady(true);
        continueRender(handle);
      })
      .catch((err) => {
        // 폰트를 못 읽어도 렌더가 멈추면 안 되니 기본 서체로 진행한다.
        console.error('kinetic font load failed:', err.message);
        continueRender(handle);
      });

    return () => {
      cancelled = true;
    };
  }, [handle]);

  return ready;
}
