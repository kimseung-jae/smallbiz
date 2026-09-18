import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { HookScene } from './scenes/HookScene';
import { PhotoScene } from './scenes/PhotoScene';
import { ClosingScene } from './scenes/ClosingScene';
import { useKineticFont } from './components/useKineticFont';
import { DUR, FONT_FAMILY, totalFrames } from './theme';

// 앞 장면이 남아 있는 위에 다음 장면이 겹쳐 들어오면서 크로스 페이드가 된다.
function FadeIn({ children, disabled }) {
  const frame = useCurrentFrame();
  const opacity = disabled
    ? 1
    : interpolate(frame, [0, DUR.transition], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });

  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Bgm({ file, total }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!file) return null;

  // 끝에서 1초 동안 소리를 줄여서 뚝 끊기지 않게 한다.
  const fadeStart = total - fps;
  const volume = interpolate(frame, [fadeStart, total], [0.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return <Audio src={staticFile(file)} volume={volume} />;
}

export function KineticReel({ photos = [], script = {}, storeName, address, music }) {
  useKineticFont();
  const list = photos.length ? photos : [];
  const total = totalFrames(list.length);
  const lines = script.lines && script.lines.length ? script.lines : [];

  if (!list.length) {
    return <AbsoluteFill style={{ backgroundColor: '#000' }} />;
  }

  let cursor = 0;
  const hookFrom = cursor;
  cursor += DUR.hook;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', fontFamily: FONT_FAMILY }}>
      <Bgm file={music} total={total} />

      <Sequence from={hookFrom} durationInFrames={DUR.hook + DUR.transition}>
        <FadeIn disabled>
          <HookScene
            photo={list[0]}
            hook={script.hook}
            highlight={script.highlight}
            durationInFrames={DUR.hook + DUR.transition}
            index={0}
          />
        </FadeIn>
      </Sequence>

      {list.map((photo, i) => {
        const from = cursor + i * DUR.photo;
        return (
          <Sequence
            key={`photo-${i}`}
            from={from}
            durationInFrames={DUR.photo + DUR.transition}
          >
            <FadeIn>
              <PhotoScene
                photo={photo}
                line={lines.length ? lines[i % lines.length] : null}
                durationInFrames={DUR.photo + DUR.transition}
                index={i + 1}
              />
            </FadeIn>
          </Sequence>
        );
      })}

      <Sequence from={cursor + list.length * DUR.photo} durationInFrames={DUR.closing}>
        <FadeIn>
          <ClosingScene
            photo={list[list.length - 1]}
            storeName={script.closing || storeName}
            address={address}
            durationInFrames={DUR.closing}
            index={list.length + 1}
          />
        </FadeIn>
      </Sequence>
    </AbsoluteFill>
  );
}
