import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { CAPTION_BASELINE, COLORS, DUR, FONT_FAMILY, SAFE, TYPE } from '../theme';

// 자막 한 줄. 아래에서 18px 올라오며 나타난다.
// delay 를 주는 이유는 컷 전환과 동시에 들어오면 둘 다 묻히기 때문이다.
export function Caption({ text, delay = DUR.captionDelay }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 120 },
    durationInFrames: DUR.captionIn,
  });

  const translateY = interpolate(enter, [0, 1], [18, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: CAPTION_BASELINE,
        paddingLeft: SAFE.side,
        paddingRight: SAFE.side,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: TYPE.caption,
          fontWeight: 700,
          lineHeight: 1.35,
          color: COLORS.text,
          textAlign: 'center',
          textShadow: COLORS.shadow,
          opacity: enter,
          transform: `translateY(${translateY}px)`,
          wordBreak: 'keep-all',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}
