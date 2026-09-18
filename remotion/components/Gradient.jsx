import React from 'react';
import { AbsoluteFill } from 'remotion';

// 자막이 밝은 사진 위에서 묻히지 않도록 아래쪽에 어두운 그라데이션을 깐다.
export function Gradient({ height = 860, opacity = 0.8 }) {
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end' }}>
      <div
        style={{
          height,
          background: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,${opacity}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
}
