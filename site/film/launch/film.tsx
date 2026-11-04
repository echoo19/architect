import type { Measured } from '../lab/film';
import { WINDOW } from '../lab/shell';
import { Chapters } from './chapters';
import { Ending, Wordmark } from './ending';
import { lockupLift, WspTail } from './wsp';
import {
  BriefFigure,
  CertFigure,
  CounterFigure,
  GpuFigures,
  HarnessFigure,
  Hero,
  LabModels,
  MuseWord,
  OpenTeacher,
  ScienceFigure,
  ScoreFigure,
  TeamSteps,
} from './reveal';
import { Screen } from './screen';
import { SpaceScene } from './space';
import { T } from './timeline';
import { camera, Cursor, LOCKUP_OUT, measuringView, walkView } from './walk';
import { OUT } from './chapters';
import { LabelsContext } from '../lab/labels';
import { LAUNCH_LABELS, SHOW_OPEN_TEACHER } from './data';

/**
 * Architect's launch film, in segments. It opens in depth (the training screen and its score, the
 * requests) and lands on the Lab's window; each section after is one moment of the app, opened by
 * a whip and, where a section starts, its line on the ground: the field, the study, the teaching,
 * the reveal, the platform, the team, Offline and the two editions. It ends on the full lockup,
 * then Architect WSP.
 * Every frame is drawn from the film's authored time alone.
 */

const FRAME = { width: 1920, height: 1080 } as const;

/** The walkthrough's world: the window and the type on the ground around it, under the camera. */
function Walk({ t, measured }: { t: number; measured: Measured }) {
  const view = camera(measured, t);
  return (
    <>
      <div
        className="absolute left-0 top-0"
        style={{
          transformOrigin: '0 0',
          transform: `translate(${FRAME.width / 2}px, ${FRAME.height / 2}px) scale(${view.s}) translate(${-view.cx}px, ${-view.cy}px)`,
        }}
      >
        <div
          id="window"
          className="absolute left-0 top-0"
          style={{ width: WINDOW.width, height: WINDOW.height }}
        >
          <Screen view={walkView(t)} style={{ left: 0, top: 0 }} />
          <Cursor measured={measured} t={t} />
          <LabModels t={t} />
          <BriefFigure t={t} />
          <HarnessFigure t={t} />
          <ScoreFigure t={t} />
          <CounterFigure t={t} />
          <CertFigure t={t} />
          <GpuFigures t={t} />
          <ScienceFigure t={t} />
          <TeamSteps t={t} />
          {SHOW_OPEN_TEACHER && <OpenTeacher t={t} measured={measured} />}
        </div>
      </div>
      <Hero t={t} view={view} measured={measured} />
      <Chapters t={t} />
    </>
  );
}

export function LaunchFilm({ t, measured }: { t: number; measured: Measured }) {
  return (
    <LabelsContext.Provider value={LAUNCH_LABELS}>
      {t < T.how ? (
        <SpaceScene t={t} measured={measured} />
      ) : (
        <>
          {/* The window glides out as the end's line rises: the two share a moment. */}
          {t < LOCKUP_OUT + OUT && <Walk t={t} measured={measured} />}
          {t >= LOCKUP_OUT && t < T.wsp + 1.2 && (
            <div
              className="absolute inset-0"
              style={{ transform: `translateY(${-lockupLift(t)}px)` }}
            >
              <Ending t={t} measured={measured} />
            </div>
          )}
          {/* After the lockup, Architect WSP rises as the lockup lifts away. */}
          {t >= T.wsp && <WspTail t={t} />}
        </>
      )}
    </LabelsContext.Provider>
  );
}

/** Every part the film measures, laid out once with the camera still. */
export function MeasuringFilm() {
  return (
    <div
      id="window"
      className="absolute left-0 top-0"
      style={{ width: WINDOW.width, height: WINDOW.height }}
    >
      <LabelsContext.Provider value={LAUNCH_LABELS}>
        <Screen view={measuringView()} style={{ left: 0, top: 0 }} />
      </LabelsContext.Provider>
      <MuseWord />
      <Wordmark />
    </div>
  );
}
