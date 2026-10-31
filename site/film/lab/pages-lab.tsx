import { Badge, Button, Meter, Spinner } from '@architect/ui';
import {
  Building2,
  ChevronRight,
  CircleCheck,
  FileText,
  FlaskConical,
  GraduationCap,
  LayoutGrid,
  ListChecks,
  Lock,
  MessageCircleQuestion,
  Package,
  Boxes,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ACADEMY, ORGANIZATIONS, RIDGELINE_FILES } from './data';
import { Panel, PlacePage, Row, Tile } from './shell';
import { count, mix, outQuart, rise, span, ui } from './time';

/** The Lab: what needs you and what is running (apps/desktop lab/cards.tsx). */
export function LabHome({ lt }: { lt: number }) {
  const needs: readonly {
    group: string;
    icon: ReactNode;
    tone: string;
    title: string;
    detail: string;
  }[] = [
    {
      group: 'Questions',
      icon: <MessageCircleQuestion strokeWidth={1.8} aria-hidden />,
      tone: 'text-mentor',
      title: 'Pricing desk',
      detail: 'A question for you',
    },
    {
      group: 'Results',
      icon: <CircleCheck strokeWidth={1.8} aria-hidden />,
      tone: 'text-student',
      title: ACADEMY,
      detail: 'Results ready',
    },
    {
      group: 'Approvals',
      icon: <ShieldCheck strokeWidth={1.8} aria-hidden />,
      tone: 'text-fg',
      title: ACADEMY,
      detail: 'Add 3 rows to assignments.csv',
    },
    {
      group: 'Lessons',
      icon: <GraduationCap strokeWidth={1.8} aria-hidden />,
      tone: 'text-mentor',
      title: 'Returns desk',
      detail: 'A lesson to review',
    },
  ];
  // The third academy run's first round, kept: 25 to 34 of 72 check tasks (docs/PROGRESS.md).
  const score = count(lt, 7.2, 1.2, 35, 47);
  return (
    <PlacePage title="Lab">
      <div className="grid grid-cols-[1fr_330px] items-start gap-4">
        <Panel title="Needs you" frame="needs">
          {needs.map((need, index) => (
            <div key={need.group} style={rise(lt, 0.5 + index * 0.09, 6)}>
              <div className="px-6 pb-2 pt-3 text-small font-medium">{need.group}</div>
              <Row
                icon={<Tile className={need.tone}>{need.icon}</Tile>}
                title={need.title}
                detail={need.detail}
                end={<ChevronRight size={16} strokeWidth={1.8} aria-hidden />}
              />
            </div>
          ))}
        </Panel>
        <div className="flex flex-col gap-4" data-frame="running">
          <Panel title="Running">
            <RunRow
              name={ACADEMY}
              state="Teaching, round 2 of 3"
              figure={`${score}%`}
              progress={mix(0.36, 0.5, outQuart(span(lt, 7.2, 4)))}
            />
            <RunRow
              name="Service desk"
              state="Practicing, round 2 of 8"
              progress={mix(0.18, 0.24, outQuart(span(lt, 2, 10)))}
            />
          </Panel>
          <Panel title="Spend" bodyClass="gap-4 px-6 pb-6">
            <Spend name={ACADEMY} spark="$0.58 of $5.00" share={0.116} glimmer="$4.26" />
            <Spend name="Returns desk" spark="$0.42 of $5.00" share={0.084} />
          </Panel>
        </div>
      </div>
    </PlacePage>
  );
}

function RunRow({
  name,
  state,
  figure,
  progress,
}: {
  name: string;
  state: string;
  figure?: string;
  progress: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line px-6 py-3.5">
      <div className="flex items-center gap-3">
        <Tile>
          <Spinner size={16} />
        </Tile>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-small">{state}</span>
        </span>
        {figure && (
          <span className="font-display text-h2 font-semibold tabular-nums">{figure}</span>
        )}
      </div>
      <Meter value={progress} label={`${name} progress`} tone="student" thickness={3} />
    </div>
  );
}

function Spend({
  name,
  spark,
  share,
  glimmer,
}: {
  name: string;
  spark: string;
  share: number;
  glimmer?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-medium">{name}</span>
      <span className="flex justify-between text-ui">
        <span>Spark</span>
        <span className="tabular-nums">{spark}</span>
      </span>
      <Meter value={share} label={`${name} Spark spend`} tone="mentor" thickness={3} />
      {glimmer && (
        <span className="flex justify-between text-ui">
          <span>Glimmer</span>
          <span className="tabular-nums">{glimmer}</span>
        </span>
      )}
    </div>
  );
}

interface FieldRow {
  name: string;
  taught: string;
  unseen: string;
  real: string;
  scores: readonly [string, string, string];
  when: string;
}

/**
 * Every field and its best final test. The academy's are its first run's (44, 43 and 12 of 48,
 * 48 and 24); the returns desk's is 58 of 60; the pricing desk's 40 of 40.
 */
const FIELDS: readonly FieldRow[] = [
  {
    name: ACADEMY,
    taught: '3',
    unseen: '2',
    real: '1',
    scores: ['92%', '90%', '50%'],
    when: 'Oct 30',
  },
  {
    name: 'Returns desk',
    taught: '1',
    unseen: '0',
    real: '-',
    scores: ['97%', '-', '-'],
    when: 'Oct 29',
  },
  {
    name: 'Pricing desk',
    taught: '1',
    unseen: '0',
    real: '-',
    scores: ['100%', '-', '-'],
    when: 'Oct 29',
  },
  {
    name: 'Service desk',
    taught: '1',
    unseen: '0',
    real: '-',
    scores: ['-', '-', '-'],
    when: 'Oct 27',
  },
];

const fieldGrid = 'grid grid-cols-[1.6fr_repeat(6,1fr)_1.1fr] items-center gap-3 px-6';

/** Fields: each field with its organizations and its best final test (apps/desktop fields/). */
export function Fields({ lt, selected }: { lt: number; selected: number }) {
  return (
    <PlacePage title="Fields" action={<Button size="sm">New field</Button>}>
      <section className="rounded-card bg-card shadow-edge" data-frame="fields">
        <div className={`${fieldGrid} pt-4 text-small font-medium`}>
          <span />
          <span className="col-span-3 border-b border-line pb-2 text-center">Organizations</span>
          <span className="col-span-3 border-b border-line pb-2 text-center">Best final test</span>
          <span />
        </div>
        <div className={`${fieldGrid} h-12 text-ui font-medium`}>
          <span>Field</span>
          <span className="text-right">Taught on</span>
          <span className="text-right">Never seen</span>
          <span className="text-right">Real</span>
          <span className="text-right">Taught on</span>
          <span className="text-right">Never seen</span>
          <span className="text-right">Real</span>
          <span className="text-right">Last activity</span>
        </div>
        {FIELDS.map((field, index) => (
          <div
            key={field.name}
            data-click={index === 0 ? 'academy-field' : undefined}
            className={`${fieldGrid} relative h-14 border-t border-line text-ui tabular-nums`}
            style={rise(lt, 0.35 + index * 0.08, 6)}
          >
            {index === 0 && (
              <span
                aria-hidden
                className="absolute inset-0 bg-hover"
                style={{ opacity: selected }}
              />
            )}
            <span className="relative font-medium">{field.name}</span>
            <span className="relative text-right">{field.taught}</span>
            <span className="relative text-right">{field.unseen}</span>
            <span className="relative text-right">{field.real}</span>
            {field.scores.map((score, column) => (
              <span key={column} className="relative text-right">
                {score}
              </span>
            ))}
            <span className="relative text-right">{field.when}</span>
          </div>
        ))}
        <div className="h-2" />
      </section>
    </PlacePage>
  );
}

const FIELD_TABS = [
  { label: 'Overview', Icon: LayoutGrid },
  { label: 'Organizations', Icon: Building2 },
  { label: 'Tasks', Icon: ListChecks },
  { label: 'Candidates', Icon: Boxes },
  { label: 'Assets', Icon: Package },
] as const;

/**
 * A field's page on its Organizations tab: the academies it is taught on, and the two it never
 * sees, sealed until the final test, one of them real.
 */
export function FieldPage({ lt }: { lt: number }) {
  return (
    <PlacePage
      title={ACADEMY}
      action={
        <span className="flex gap-2">
          <span data-click="open-job">
            <Button size="sm">Open the job</Button>
          </span>
          <Button size="sm" variant="primary">
            <FlaskConical size={16} strokeWidth={1.8} aria-hidden />
            New experiment
          </Button>
        </span>
      }
    >
      <div className="-mt-2 flex h-10 w-fit items-center gap-1 rounded-full p-1 shadow-edge">
        {FIELD_TABS.map(({ label, Icon }) => (
          <span
            key={label}
            className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-ui ${label === 'Organizations' ? 'bg-selected font-medium' : ''}`}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden />
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_320px] items-start gap-4">
        <Panel title="Organizations" frame="orgs">
          {ORGANIZATIONS.map((org, index) => {
            const sealed = org.role === 'Never seen';
            const lock = ui(lt, 2.8 + (index - 3) * 0.45, 0.32);
            return (
              <div key={org.name} style={rise(lt, 0.4 + index * 0.08, 6)}>
                <Row
                  selected={index === 0 ? 1 : 0}
                  icon={
                    <Tile>
                      {sealed ? (
                        <span className="relative size-4">
                          <Building2
                            className="absolute inset-0"
                            strokeWidth={1.8}
                            style={{ opacity: 1 - lock }}
                            aria-hidden
                          />
                          <Lock
                            className="absolute inset-0"
                            strokeWidth={1.8}
                            style={{ opacity: lock, transform: `scale(${mix(0.6, 1, lock)})` }}
                            aria-hidden
                          />
                        </span>
                      ) : (
                        <Building2 strokeWidth={1.8} aria-hidden />
                      )}
                    </Tile>
                  }
                  title={org.name}
                  detail={`${org.kind} · ${org.files} files${org.rows ? ` · ${org.rows.toLocaleString('en-US')} rows` : ''}`}
                  end={
                    sealed ? (
                      <span
                        className="flex items-center gap-2"
                        style={{ opacity: mix(0.35, 1, lock) }}
                      >
                        {org.kind === 'Real' && <Badge tone="student">Real</Badge>}
                        Never seen
                      </span>
                    ) : (
                      'Taught on'
                    )
                  }
                />
              </div>
            );
          })}
          <p className="m-0 border-t border-line px-6 py-4 text-ui" style={rise(lt, 4.2, 6)}>
            Never seen: sealed away from teaching, and opened once for the final test.
          </p>
        </Panel>
        <Panel title="Ridgeline Test Prep">
          {RIDGELINE_FILES.map(([file, size], index) => (
            <div
              key={file}
              className="flex h-11 items-center justify-between border-t border-line px-6"
              style={rise(lt, 0.7 + index * 0.05, 5)}
            >
              <span className="flex items-center gap-2.5 font-mono text-small">
                <FileText size={14} strokeWidth={1.8} aria-hidden />
                {file}
              </span>
              <span className="text-small tabular-nums">{size}</span>
            </div>
          ))}
        </Panel>
      </div>
    </PlacePage>
  );
}
