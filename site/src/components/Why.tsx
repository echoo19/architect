import { WHY } from '../content';
import { Others } from './Others';
import { Reveal } from './Reveal';

/**
 * Why we made Architect: the title and when the build began, our reason beside them, then
 * published work from others pointing the same way, Y Combinator's requests among it, one at a
 * time.
 */
export function Why() {
  return (
    <section id="why" aria-labelledby="why-title" className="page scroll-mt-16 pb-24 lg:pb-32">
      <Reveal className="grid gap-6 border-t border-line pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:pt-24">
        <div className="flex flex-col gap-3">
          <h2 id="why-title" className="t-title">
            {WHY.title}
          </h2>
          <p className="t-small m-0">{WHY.started}</p>
        </div>
        <p className="t-lead max-w-[36rem]">{WHY.reason}</p>
      </Reveal>
      <Others />
    </section>
  );
}
