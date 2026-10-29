import { ApprovalCard, Steps, UserBubble, WaitingLine, Reply } from './chat';
import { AppWindow, ChatComposer, ChatHeader, Sidebar } from './frame';
import { at } from './motion';
import { ChapterStage } from './stage';

const AGENTS = [
  {
    name: 'Service desk',
    chats: [
      { title: 'Price the two jobs Dana finished' },
      { title: 'Close out Tuesday' },
      { title: 'Invoice the Cedar Ave panel repair', current: true },
    ],
  },
  { name: 'Returns desk', chats: [{ title: 'Can order 1187 come back?' }] },
];

const STEPS = [
  { action: 'Read', target: 'data/jobs.csv', meta: '1 row' },
  { action: 'Read', target: 'data/policy.md' },
];

/**
 * Using the agent: it reads the files it was given, works out the invoice, and stops at a change
 * to a file, which waits for the person's answer. The frame at the end is the wait.
 */
export function UseMock() {
  return (
    <ChapterStage
      id="use"
      label="The Architect workspace. The agent has read two files and worked out an invoice. It wants to add a row to invoices.csv, and the row is shown with Deny and Allow once. Nothing is saved until the person answers."
      heightWide={664}
      heightCompact={730}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex wide:inset-x-7 wide:top-6">
        <Sidebar agents={AGENTS} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader title="Invoice the Cedar Ave panel repair" />
          <div className="min-h-0 flex-1 overflow-hidden px-8 pt-5 narrow:px-4">
            <div className="mx-auto flex max-w-[720px] flex-col gap-6 text-chat">
              <UserBubble className="a a-up" style={at(250, { dy: 36, dur: 700 })}>
                Invoice the Cedar Ave panel repair.
              </UserBubble>
              <Reply>
                <Steps
                  header="Worked for 38 s"
                  steps={STEPS}
                  hideOnNarrow={[1]}
                  headerStyle={at(1000, { dy: 10 })}
                  headerClassName="a a-up"
                  stepClassName="a a-wipe"
                  stepStyle={(index) => at(1250 + index * 420, { dur: 520 })}
                />
                <ApprovalCard
                  file="data/invoices.csv"
                  summary="1 new row"
                  columns={['invoice', 'job', 'customer', 'total']}
                  rows={[{ cells: ['INV-4473', 'J-4473', 'Lindqvist', '$1,116.52'] }]}
                  hideOnNarrow={[1, 2]}
                  className="a a-up"
                  style={at(2700, { dy: 20, dur: 700 })}
                  bodyClassName="a a-unfold"
                  bodyStyle={at(3200, { dur: 600 })}
                  buttonsClassName="a a-pop"
                  buttonsStyle={at(3500, { dur: 400 })}
                />
                <WaitingLine className="a a-up" style={at(4000, { dy: 8 })} />
              </Reply>
            </div>
          </div>
          <ChatComposer agent="Service desk" />
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
