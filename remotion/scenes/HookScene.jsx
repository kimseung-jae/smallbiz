import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { KenBurns } from '../components/KenBurns';
import { Gradient } from '../components/Gradient';
import { COLORS, FONT_FAMILY, HOOK_CENTER_Y, SAFE, TYPE } from '../theme';

// 첫 1~3초가 끝까지 볼지를 가른다. 훅 문장은 어절 단위로 순차 등장시켜 시선을 붙잡는다.
export function HookScene({ photo, hook, highlight, durationInFrames, index = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = String(hook || '').split(/\s+/).filter(Boolean);

  return (
    <AbsoluteFill>
      <KenBurns src={photo} durationInFrames={durationInFrames} index={index} to={1.12} />
      <Gradient height={1100} opacity={0.55} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: HOOK_CENTER_Y,
          paddingLeft: SAFE.side,
          paddingRight: SAFE.side,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0 22px',
          }}
        >
          {words.map((word, i) => {
            const enter = spring({
              frame: frame - i * 3,
              fps,
              config: { damping: 200, stiffness: 110 },
              durationInFrames: 16,
            });
            const isHighlight = highlight && word.includes(highlight);

            return (
              <span
                key={`${word}-${i}`}
                style={{
                  fontFamily: FONT_FAMILY,
                  fontSize: TYPE.hook,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  color: isHighlight ? COLORS.highlight : COLORS.text,
                  textShadow: COLORS.shadow,
                  opacity: enter,
                  transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
                  wordBreak: 'keep-all',
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
