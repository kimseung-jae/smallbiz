import React from 'react';
import { Composition } from 'remotion';
import { KineticReel } from './KineticReel';
import { FPS, HEIGHT, WIDTH, totalFrames } from './theme';

// 영상 길이는 사진 장수에 따라 달라지므로 calculateMetadata 에서 계산한다.
export function RemotionRoot() {
  return (
    <Composition
      id="KineticReel"
      component={KineticReel}
      durationInFrames={totalFrames(3)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{
        photos: [],
        script: {
          hook: '20년 내공, 숯불향',
          highlight: '숯불향',
          lines: ['밑반찬은 무한 리필', '참숯에 직접 굽습니다', '단골이 증명하는 맛'],
          closing: '안마을돼지불백',
        },
        storeName: '안마을돼지불백',
        address: '',
        music: null,
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: totalFrames((props.photos || []).length),
      })}
    />
  );
}
