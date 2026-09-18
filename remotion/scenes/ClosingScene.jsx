import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { KenBurns } from '../components/KenBurns';
import { COLORS, FONT_FAMILY, SAFE, TYPE } from '../theme';

// 마지막에 매장명을 남긴다. 영상을 본 사람이 기억해야 하는 것은 결국 가게 이름이다.
export function ClosingScene({ photo, storeName, address, durationInFrames, index = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - 6,
    fps,
    config: { damping: 200, stiffness: 110 },
    durationInFrames: 20,
  });

  return (
    <AbsoluteFill>
      <KenBurns
        src={photo}
        durationInFrames={durationInFrames}
        index={index}
        from={1.06}
        to={1}
      />
      <AbsoluteFill style={{ backgroundColor: COLORS.overlay }} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: SAFE.side,
          paddingRight: SAFE.side,
          paddingBottom: SAFE.bottom / 2,
        }}
      >
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: TYPE.store,
            fontWeight: 800,
            color: COLORS.text,
            textAlign: 'center',
            textShadow: COLORS.shadow,
            lineHeight: 1.2,
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
            wordBreak: 'keep-all',
          }}
        >
          {storeName}
        </div>
        {address ? (
          <div
            style={{
              marginTop: 28,
              fontFamily: FONT_FAMILY,
              fontSize: TYPE.address,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.78)',
              textAlign: 'center',
              opacity: interpolate(enter, [0.4, 1], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }),
              wordBreak: 'keep-all',
            }}
          >
            {address}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
