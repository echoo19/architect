import type { ReactNode } from 'react';
import { LogoMark } from '@architect/ui';
import { Actors } from '../src/components/Actors';
import { Forest, type ForestRow } from '../src/components/Forest';
import { RoundDiagram } from '../src/components/RoundDiagram';
import { SECOND, TARGET_PASSES, TEST_SIZE } from '../src/evidence';
import { AskMock } from '../src/mock/ask';
import { DescribeMock } from '../src/mock/describe';
import { HeroWindow } from '../src/mock/hero-window';
import { ResultMock } from '../src/mock/result';
import { RuleMock } from '../src/mock/rule';
import { ShareMock } from '../src/mock/share';
import { TrainMock } from '../src/mock/train';
import { UseMock } from '../src/mock/use';
import anthropic from './logos/anthropic.svg';
import gemini from './logos/googlegemini.svg';
import huggingFace from './logos/huggingface.svg';
import meta from './logos/meta.svg';
import ollama from './logos/ollama.svg';
import openai from './logos/openai-knot.svg';
import openrouter from './logos/openrouter.svg';
import yc from './logos/ycombinator.svg';
import type { LayerId } from './timeline';

/**
 * The film's pictures, one layer each, all in the page from the start. A layer is hidden until the
 * cut brings it in (see seek.ts). Mocks and charts are laid out at a fixed width and scaled to fit
 * the frame; cards fill the frame.
 */

/** The width a mock or a chart is laid out at, in css pixels. */
const FIT_WIDTH: Partial<Record<LayerId, number>> = {
  forest: 1100,
  diagram: 1240,
};
export const MOCK_WIDTH = 1240;

const TEACHERS = [meta, openai, anthropic, gemini, openrouter, ollama] as const;

function Logo({ src, height, at }: { src: string; height: number; at: number }) {
  return <img src={src} alt="" className="film-white w-auto" style={{ height }} data-at={at} />;
}

const lockup = (
  <span className="flex items-center gap-10">
    <span data-at={0.2}>
      <LogoMark size={150} />
    </span>
    <span
      data-at={0.5}
      className="font-display text-[150px] font-semibold leading-none tracking-[-0.03em]"
    >
      Architect
    </span>
  </span>
);

function Card({ children, gap = 'gap-12' }: { children: ReactNode; gap?: string }) {
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center ${gap}`}>
      {children}
    </div>
  );
}

/** A model's name beside the Meta mark, in the display type. */
function ModelCard({ name }: { name: 'Glimmer' | 'Spark' }) {
  return (
    <Card>
      <span className="flex items-center gap-14">
        <Logo src={meta} height={116} at={0.3} />
        <span
          data-at={0.7}
          className="font-display text-[132px] font-semibold leading-none tracking-[-0.03em]"
        >
          Muse <span className={name === 'Spark' ? 'text-mentor' : 'text-student'}>{name}</span>
        </span>
      </span>
    </Card>
  );
}

const FOREST_ROWS: readonly ForestRow[] = SECOND.arms.map((arm) => ({
  label: (
    <span className="text-pretty">
      <Actors text={arm.name} />
    </span>
  ),
  value: (arm.passed / TEST_SIZE) * 100,
  low: arm.low,
  high: arm.high,
  tone: arm.tone,
  figure: (
    <span className="font-display text-h2 font-semibold">
      {arm.passed}
      <span className="t-body ml-1.5"> of {TEST_SIZE}</span>
    </span>
  ),
  summary: `${arm.name}: ${arm.passed} of ${TEST_SIZE}.`,
}));

/**
 * A picture in the frame. The outer box centers it and scales it to fit; the inner one is the
 * camera's, which pushes in on a point of it.
 */
function Layer({ id, width, children }: { id: LayerId; width?: number; children: ReactNode }) {
  return (
    <div className="film-layer" data-layer={id}>
      {width === undefined ? (
        <div className="film-cam film-cam-full">
          <div className="film-view">{children}</div>
        </div>
      ) : (
        <div className="film-cam" data-fit="" style={{ width }}>
          <div className="film-view">{children}</div>
        </div>
      )}
    </div>
  );
}

export function Film() {
  return (
    <>
      <Layer id="rule" width={MOCK_WIDTH}>
        <RuleMock />
      </Layer>
      <Layer id="forest" width={FIT_WIDTH.forest ?? MOCK_WIDTH}>
        <div data-forest="">
          <Forest
            name="Final-test pass rate by arm on a new returns desk"
            rows={FOREST_ROWS}
            min={0}
            max={100}
            ticks={[0, 25, 50, 75, 100]}
            formatTick={(value) => `${value}%`}
            target={{
              at: 95,
              label: `The job's target: 95%, which is ${TARGET_PASSES} of ${TEST_SIZE}`,
            }}
          />
        </div>
      </Layer>
      <Layer id="end">
        <Card gap="gap-16">
          {lockup}
          <span
            data-at={1.4}
            data-from={164.4}
            className="font-sans text-[44px] font-medium leading-none"
          >
            echoo19.github.io/architect
          </span>
        </Card>
      </Layer>
      <Layer id="describe" width={MOCK_WIDTH}>
        <DescribeMock />
      </Layer>
      <Layer id="glimmer">
        <ModelCard name="Glimmer" />
      </Layer>
      <Layer id="spark">
        <ModelCard name="Spark" />
      </Layer>
      <Layer id="ask" width={MOCK_WIDTH}>
        <AskMock />
      </Layer>
      <Layer id="train" width={MOCK_WIDTH}>
        <TrainMock />
      </Layer>
      <Layer id="test" width={MOCK_WIDTH}>
        <ResultMock />
      </Layer>
      <Layer id="hero" width={MOCK_WIDTH}>
        <HeroWindow />
      </Layer>
      <Layer id="use" width={MOCK_WIDTH}>
        <UseMock />
      </Layer>
      <Layer id="teachers">
        <Card>
          <span className="flex items-center gap-24">
            {TEACHERS.map((src, index) => (
              <Logo key={src} src={src} height={104} at={0.8 + index * 0.6} />
            ))}
          </span>
        </Card>
      </Layer>
      <Layer id="yc">
        <Card gap="gap-14">
          <img src={yc} alt="" className="size-[300px]" data-at={0.3} />
          <span
            data-at={0.9}
            className="font-display text-[84px] font-semibold leading-none tracking-[-0.03em]"
          >
            Vertical models
          </span>
        </Card>
      </Layer>
      <Layer id="diagram" width={FIT_WIDTH.diagram ?? MOCK_WIDTH}>
        <div data-diagram="">
          <RoundDiagram />
        </div>
      </Layer>
      <Layer id="share" width={MOCK_WIDTH}>
        <ShareMock />
      </Layer>
      <Layer id="hf">
        <Card gap="gap-20">
          <Logo src={huggingFace} height={240} at={0.3} />
          <span className="flex items-center gap-16">
            {TEACHERS.map((src, index) => (
              <Logo key={src} src={src} height={76} at={1.1 + index * 0.25} />
            ))}
          </span>
        </Card>
      </Layer>
    </>
  );
}
