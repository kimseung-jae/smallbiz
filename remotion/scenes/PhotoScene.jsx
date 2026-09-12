import React from 'react';
import { AbsoluteFill } from 'remotion';
import { KenBurns } from '../components/KenBurns';
import { Gradient } from '../components/Gradient';
import { Caption } from '../components/Caption';

// 사진 한 장에 자막 한 줄. 이 스타일의 기본 단위다.
export function PhotoScene({ photo, line, durationInFrames, index = 0 }) {
  return (
    <AbsoluteFill>
      <KenBurns src={photo} durationInFrames={durationInFrames} index={index} />
      <Gradient />
      {line ? <Caption text={line} /> : null}
    </AbsoluteFill>
  );
}
