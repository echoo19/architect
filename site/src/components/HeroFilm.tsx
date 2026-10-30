import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { FILM } from '../content';

/**
 * The walkthrough film, still on a frame of training until it is asked for. Nothing loads before
 * then. One press plays it with sound, and from there the browser's own controls take over.
 */
export function HeroFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-card bg-card outline-1 -outline-offset-1 outline-line">
      <video
        ref={video}
        className="block size-full"
        src={FILM.src}
        poster={FILM.poster}
        preload="none"
        playsInline
        controls={started}
        aria-label={FILM.label}
        onPlay={() => setStarted(true)}
      />
      {!started && (
        <button
          type="button"
          aria-label={FILM.play}
          className="group absolute inset-0 grid cursor-pointer place-items-center"
          onClick={() => {
            setStarted(true);
            void video.current?.play();
          }}
        >
          <span className="grid size-16 place-items-center rounded-full bg-primary text-on-primary transition-transform duration-300 ease-[var(--ease-enter)] group-hover:scale-110 group-active:scale-95 sm:size-20">
            <Play size={26} fill="currentColor" strokeWidth={0} className="ml-1" aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}
