import type { ReactNode } from 'react';
import { Chapter } from './components/Chapter';
import { Closing } from './components/Closing';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { ResultsSlot } from './components/ResultsSlot';
import { CHAPTERS, type ChapterId } from './content';
import { DescribeMock } from './mock/describe';
import { ReportMock } from './mock/report';
import { ShareMock } from './mock/share';
import { TeachMock } from './mock/teach';
import { TrainMock } from './mock/train';
import { UseMock } from './mock/use';

const MOCKS: Record<ChapterId, ReactNode> = {
  describe: <DescribeMock />,
  train: <TrainMock />,
  test: (
    <>
      <ReportMock />
      <ResultsSlot />
    </>
  ),
  teach: <TeachMock />,
  share: <ShareMock />,
  use: <UseMock />,
};

export function App() {
  return (
    <div id="top">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to the content
      </a>
      <Header />
      <main id="main">
        <Hero />
        {CHAPTERS.map((copy) => (
          <Chapter key={copy.id} copy={copy}>
            {MOCKS[copy.id]}
          </Chapter>
        ))}
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
