import { useRef, useState } from 'react';
import { LogoMark } from '@architect/ui';
import { Play } from 'lucide-react';
import { FILM } from '../content';

/**
 * The walkthrough film behind a still cover: the film's own title card, set in the page's type,
 * and one button. Nothing loads before the button is pressed. The cover stays until the film is
 * actually playing, then fades, so there is never a black frame between them; from there the
 * browser's own controls take over. If the film cannot play, the cover steps aside all the same,
 * so the browser can say why.
 */
export function HeroFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  return (
    <div className="@container relative aspect-video overflow-hidden rounded-card bg-ground outline-1 -outline-offset-1 outline-line-strong">
      <video
        ref={video}
        className="block size-full"
        src={FILM.src}
        preload="none"
        playsInline
        controls={playing}
        aria-label={FILM.label}
        onPlaying={() => setPlaying(true)}
        onError={() => setPlaying(true)}
      />
      <button
        type="button"
        aria-label={FILM.play}
        className="film-cover absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-[6cqw] bg-ground"
        {...(playing ? { 'data-leaving': '' } : {})}
        disabled={started}
        onClick={() => {
          setStarted(true);
          video.current?.play().catch(() => setPlaying(true));
        }}
      >
        <span className="flex items-center gap-[1.4cqw] font-display text-[4.4cqw] font-semibold leading-none tracking-[-0.03em]">
          <LogoMark size={18} className="size-[0.9em]" />
          Architect
        </span>
        <span className="film-play grid size-14 place-items-center rounded-full bg-primary text-on-primary sm:size-18">
          <Play size={24} fill="currentColor" strokeWidth={0} className="ml-1" aria-hidden />
        </span>
      </button>
    </div>
  );
}
