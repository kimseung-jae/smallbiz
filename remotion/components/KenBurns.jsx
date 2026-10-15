import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

// 사진을 천천히 확대한다. 확대 기준점을 컷마다 번갈아 바꿔야 같은 움직임이 반복되지 않는다.
const ORIGINS = ['20% 25%', '80% 75%', '75% 25%', '25% 75%'];

export function KenBurns({ src, durationInFrames, index = 0, from = 1, to = 1.09 }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
      <img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
          transformOrigin: ORIGINS[index % ORIGINS.length],
        }}
      />
    </AbsoluteFill>
  );
}
