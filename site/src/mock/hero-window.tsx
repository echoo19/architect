import { KeepIds, Ledger, P, Reply, UserBubble, WorkedFor } from './chat';
import { AppWindow, ChatHeader, Sidebar } from './frame';
import { CHATS, deskSidebar } from './jobs';
import { at } from './motion';
import { Stage } from './stage';

/**
 * The window over the page's first screen: the returns desk agent answering one request, from the
 * shop's own policy and records. It plays once when the page opens and holds its last frame, and
 * all of its motion is CSS, so it can be played to any moment. The window is near its real size and
 * cropped by the band's bottom edge.
 */

const ASK =
  "Nico Mbeki wants to return the Two-Person Backpacking Tent from order ORD-10506. It's opened. Can it come back, and what does he get?";

const BULLETS = [
  'An opened tent has a 15% restocking fee.',
  'Nico is not a member, so he pays the $6.95 return label.',
] as const;

const REFUND: readonly (readonly [string, string])[] = [
  ['Two-Person Backpacking Tent', '$311.96'],
  ['Restocking fee, 15%', '-$46.79'],
  ['Return label', '-$6.95'],
  ['Refund to card', '$258.22'],
];

/** When things arrive, in ms from the start. */
const BUBBLE = 350;
const WORKED = 1250;
const LEAD = 1750;
const BULLET = 3300;
const INTRO = 4150;
const LEDGER = 4550;
const ROW = 4900;
const ROW_STEP = 330;

export function HeroWindow() {
  return (
    <Stage
      id="hero"
      label="The Architect window with the returns desk agent of an outdoor-gear shop answering a request. A customer wants to return an opened tent. The agent says it can come back, inside the 30 day window, and works out the refund in a short table: the tent at $311.96, a 15% restocking fee, the return label, and $258.22 back to the card."
      heightWide={650}
      playback="playing"
    >
      <AppWindow className="inset-x-3 top-3 flex h-[800px] wide:inset-x-7 wide:top-7">
        <Sidebar agents={deskSidebar(CHATS, 0)} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader title={CHATS[0]} />
          <div className="min-h-0 flex-1 overflow-hidden px-8 pt-6 narrow:px-4 narrow:pt-4">
            <div className="mx-auto flex max-w-[720px] flex-col gap-7 text-body">
              <UserBubble className="a a-up" style={at(BUBBLE, { dy: 28, dur: 800 })}>
                <KeepIds text={ASK} />
              </UserBubble>
              <Reply>
                <WorkedFor className="a a-up" style={at(WORKED, { dy: 10 })}>
                  Worked for 1 min 31 s, 4 steps
                </WorkedFor>
                <P className="a a-wipe" style={at(LEAD, { dur: 1300 })}>
                  Yes. The tent was delivered 23 days ago, inside the 30 day window, and Nico gets{' '}
                  <strong className="font-semibold">$258.22</strong> back on his card.
                </P>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 narrow:hidden">
                  {BULLETS.map((bullet, index) => (
                    <li
                      key={bullet}
                      className="a a-up flex gap-3"
                      style={at(BULLET + index * 220, { dy: 10 })}
                    >
                      <span aria-hidden className="mt-[0.7em] size-1 shrink-0 rounded-full bg-fg" />
                      {bullet}
                    </li>
                  ))}
                </ul>
                <P className="a a-up" style={at(INTRO, { dy: 10 })}>
                  Here is how the refund adds up:
                </P>
                <Ledger
                  title="Refund for order ORD-10506"
                  rows={REFUND}
                  className="a a-up"
                  style={at(LEDGER, { dy: 14, dur: 600 })}
                  rowClassName="a a-up"
                  rowStyle={(index) => at(ROW + index * ROW_STEP, { dy: 8, dur: 500 })}
                />
              </Reply>
            </div>
          </div>
        </div>
      </AppWindow>
    </Stage>
  );
}
