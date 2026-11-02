import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { FILM, type FilmSource } from '../content';

/**
 * A film behind a still cover, the walkthrough unless another is named: a frame from the film, and
 * one button. Only the still loads before the button is pressed. The cover stays until the film is
 * actually playing, then fades, so there is never a black frame between them; from there the
 * browser's own controls take over. If the film cannot play, the cover steps aside all the same,
 * so the browser can say why.
 */
export function HeroFilm({ film = FILM }: { film?: FilmSource }) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  return (
    <div className="@container relative aspect-video overflow-hidden rounded-card bg-ground outline-1 -outline-offset-1 outline-line-strong">
      <video
        ref={video}
        className="block size-full"
        src={film.src}
        poster={film.cover}
        preload="none"
        playsInline
        controls={playing}
        aria-label={film.label}
        onPlaying={() => setPlaying(true)}
        onError={() => setPlaying(true)}
      />
      <button
        type="button"
        aria-label={film.play}
        className="film-cover absolute inset-0 grid cursor-pointer place-items-center bg-ground"
        {...(playing ? { 'data-leaving': '' } : {})}
        disabled={started}
        onClick={() => {
          setStarted(true);
          video.current?.play().catch(() => setPlaying(true));
        }}
      >
        <img
          className="absolute inset-0 size-full object-cover opacity-70"
          src={film.cover}
          alt=""
          width={1920}
          height={1080}
          decoding="async"
        />
        <span className="film-play relative grid size-14 place-items-center rounded-full bg-primary text-on-primary sm:size-18">
          <Play size={24} fill="currentColor" strokeWidth={0} className="ml-1" aria-hidden />
        </span>
      </button>
    </div>
  );
}
