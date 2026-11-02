import { Badge, Button, Card, CardRow, EmptyState, Meter, RowIcon, Spinner } from '@architect/ui';
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
  LockOpen,
  MessageCircleQuestion,
  Package,
  Boxes,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ACADEMY, ORGANIZATIONS, RIDGELINE_FILES } from './data';
import { useLabels } from './labels';
import { PlacePage } from './shell';
import { count, mix, outQuart, rise, span, ui } from './time';

const chevron = <ChevronRight size={16} strokeWidth={1.8} aria-hidden />;

/**
 * The Lab: what needs you and what is running (apps/desktop lab/cards.tsx). The row's icon names
 * the kind and its end word what to do; a detail line stays only where it says something specific.
 */
export function LabHome({
  lt,
  hover = 0,
  score: [scoreFrom, scoreTo] = [35, 47],
}: {
  lt: number;
  /** The teaching run's check score before and after its last kept round, in percent. */
  score?: readonly [number, number];
  /** How far the pointer's hover has lit the academy desk's running row, from 0 to 1. */
  hover?: number;
}) {
  const needs: readonly {
    kind: string;
    icon: ReactNode;
    title: string;
    detail?: string;
    end: string;
  }[] = [
    {
      kind: 'question',
      icon: <MessageCircleQuestion strokeWidth={1.8} aria-hidden />,
      title: 'Pricing desk',
      end: 'Question',
    },
    {
      kind: 'results',
      icon: <CircleCheck strokeWidth={1.8} aria-hidden />,
      title: ACADEMY,
      end: 'Results',
    },
    {
      kind: 'approval',
      icon: <ShieldCheck strokeWidth={1.8} aria-hidden />,
      title: ACADEMY,
      detail: 'Add 3 rows to assignments.csv',
      end: 'Approve',
    },
    {
      kind: 'lesson',
      icon: <GraduationCap strokeWidth={1.8} aria-hidden />,
      title: 'Returns desk',
      end: 'Review',
    },
  ];
  // The third academy run's first round, kept: 25 to 34 of 72 check tasks (docs/PROGRESS.md).
  const score = count(lt, 7.2, 1.2, scoreFrom, scoreTo);
  return (
    <PlacePage title="Lab">
      <div className="grid grid-cols-[1fr_330px] items-start gap-4">
        <Card title="Needs you" flush>
          {needs.map((need, index) => (
            <div
              key={need.kind}
              className="overflow-hidden"
              style={
                index === 0
                  ? {
                      // A new question arrives while the Lab is watched, and the rest make room.
                      height: 56 * outQuart(span(lt, 3.8, 0.7)),
                      opacity: outQuart(span(lt, 4.0, 0.6)),
                    }
                  : rise(lt, 0.5 + index * 0.09, 6)
              }
            >
              <CardRow
                icon={<RowIcon>{need.icon}</RowIcon>}
                title={need.title}
                detail={need.detail}
                end={
                  <>
                    {need.end}
                    {chevron}
                  </>
                }
              />
            </div>
          ))}
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Running" flush>
            <RunRow
              name={ACADEMY}
              hover={hover}
              state="Teaching, round 2 of 3"
              figure={`${score}%`}
              progress={mix(0.36, 0.5, outQuart(span(lt, 7.2, 4)))}
            />
            <RunRow
              name="Service desk"
              state="Practicing, round 2 of 8"
              progress={mix(0.18, 0.24, outQuart(span(lt, 2, 10)))}
            />
          </Card>
          <Card title="Spend">
            <div className="flex flex-col gap-4">
              <Spend name={ACADEMY} spark="$0.58 of $5.00" share={0.116} glimmer="$4.26" />
              <Spend name="Returns desk" spark="$0.42 of $5.00" share={0.084} />
            </div>
          </Card>
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
  hover = 0,
}: {
  name: string;
  state: string;
  figure?: string;
  progress: number;
  hover?: number;
}) {
  return (
    <div className="relative flex flex-col gap-3 border-t border-line px-6 py-3.5">
      {hover > 0 && (
        <span aria-hidden className="absolute inset-0 bg-hover" style={{ opacity: hover }} />
      )}
      <div className="flex items-center gap-3">
        <RowIcon>
          <Spinner size={16} />
        </RowIcon>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
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
  /** A screening lab's desk, which the team scene turns to. */
  lab?: boolean;
}

/**
 * Every field and its best final test. The academy's are its first run's (44, 43 and 12 of 48,
 * 48 and 24); the returns desk's is 58 of 60; the pricing desk's 40 of 40. The screening labs'
 * two desks (examples/assay-desk, examples/inventory-desk) are taught on three labs with a fourth
 * sealed, and have no final test yet.
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
  {
    name: 'Assay desk',
    taught: '3',
    unseen: '1',
    real: '-',
    scores: ['-', '-', '-'],
    when: 'Oct 31',
    lab: true,
  },
  {
    name: 'Inventory desk',
    taught: '3',
    unseen: '1',
    real: '-',
    scores: ['-', '-', '-'],
    when: 'Oct 31',
    lab: true,
  },
];

const fieldGrid = 'grid grid-cols-[1.6fr_repeat(6,1fr)_1.1fr] items-center gap-3 px-6';

/**
 * Fields: each field with its organizations and its best final test (apps/desktop fields/).
 * `selected` lights the academy's row, and `lab` the screening labs' desks.
 */
export function Fields({
  lt,
  selected,
  lab = 0,
  scores,
  when,
}: {
  lt: number;
  selected: number;
  lab?: number;
  /** Last activity to show in place of a field's own, by the field's name. */
  when?: Readonly<Record<string, string>>;
  /** Best final tests to show in place of a field's own, by the field's name. */
  scores?: Readonly<Record<string, readonly [string, string, string]>>;
}) {
  const labels = useLabels();
  return (
    <PlacePage title="Fields" action={<Button size="sm">New field</Button>}>
      <section className="rounded-card surface-card">
        <div className={`${fieldGrid} pt-4 text-small font-medium`}>
          <span />
          <span className="col-span-3 border-b border-line pb-2 text-center">Organizations</span>
          <span className="col-span-3 border-b border-line pb-2 text-center">
            {labels.bestFinalTest}
          </span>
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
            {(index === 0 || field.lab) && (
              <span
                aria-hidden
                className="absolute inset-0 bg-hover"
                style={{ opacity: field.lab ? lab : selected }}
              />
            )}
            <span className="relative font-medium">{field.name}</span>
            <span className="relative text-right">{field.taught}</span>
            <span className="relative text-right">{field.unseen}</span>
            <span className="relative text-right">{field.real}</span>
            {(scores?.[field.name] ?? field.scores).map((score, column) => (
              <span
                key={column}
                data-frame={`${field.name}-${column}`}
                className="relative text-right"
              >
                {score}
              </span>
            ))}
            <span className="relative text-right">{when?.[field.name] ?? field.when}</span>
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

/** The field page's tab strip, with one tab open. */
export function FieldTabs({ open }: { open: (typeof FIELD_TABS)[number]['label'] }) {
  return (
    <div className="-mt-2 flex h-10 w-fit items-center gap-1 rounded-full p-1 shadow-edge">
      {FIELD_TABS.map(({ label, Icon }) => (
        <span
          key={label}
          className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-ui ${label === open ? 'bg-selected font-medium' : ''}`}
        >
          <Icon size={15} strokeWidth={1.8} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

/** What an organization's row says under its name: generated or not, and what it holds. */
function orgDetail(org: (typeof ORGANIZATIONS)[number]): string {
  const rows = org.rows ? `, ${org.rows.toLocaleString('en-US')} rows` : '';
  // A real organization carries its Real chip, so its row doesn't say it again.
  return org.kind === 'Real' ? `${org.files} files` : `${org.kind}, ${org.files} files${rows}`;
}

/** A row's selected fill, fading as the choice moves from one row to another. */
function Chosen({ shown, children }: { shown: number; children: ReactNode }) {
  return (
    <div className="relative">
      {shown > 0 && (
        <span aria-hidden className="absolute inset-0 bg-selected" style={{ opacity: shown }} />
      )}
      {children}
    </div>
  );
}

/**
 * A field's page on its Organizations tab: the academies it is taught on, and the two it never
 * sees, sealed until the final test, one of them real.
 */
export function FieldPage({
  lt,
  unlock = 0,
}: {
  lt: number;
  /** How far the sealed academy's lock has opened, from 0 to 1, as its final test begins. */
  unlock?: number;
}) {
  // After the seals close, the sealed academy is chosen: what it holds stays out of view.
  const pick = ui(lt, 5.4, 0.3);
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
      <FieldTabs open="Organizations" />
      <div className="grid grid-cols-[1fr_320px] items-start gap-4">
        <Card title="Organizations" flush>
          {ORGANIZATIONS.map((org, index) => {
            const sealed = org.role === 'Never seen';
            const lock = ui(lt, 2.8 + (index - 3) * 0.45, 0.32);
            return (
              <div key={org.name} style={rise(lt, 0.4 + index * 0.08, 6)}>
                <Chosen shown={index === 0 ? 1 - pick : index === 3 ? pick : 0}>
                  <CardRow
                    className="relative"
                    icon={
                      <RowIcon>
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
                      </RowIcon>
                    }
                    title={org.name}
                    detail={orgDetail(org)}
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
                </Chosen>
              </div>
            );
          })}
        </Card>
        {/* The chosen academy's card: Ridgeline's files, then Harborview, which shows nothing. */}
        <div className="grid">
          <div className="flex [grid-area:1/1]" style={{ opacity: 1 - pick }}>
            <Card title="Ridgeline Test Prep" flush className="w-[320px]">
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
            </Card>
          </div>
          <div
            className="flex [grid-area:1/1]"
            style={{ opacity: pick, transform: `translateY(${(1 - pick) * 8}px)` }}
          >
            <Card title="Harborview Prep" flush className="w-[320px]">
              <div className="flex flex-1 items-center justify-center border-t border-line">
                <EmptyState
                  icon={
                    <span data-frame="vault" className="relative size-5">
                      <Lock
                        className="absolute inset-0"
                        strokeWidth={1.8}
                        style={{ opacity: 1 - unlock }}
                        aria-hidden
                      />
                      <LockOpen
                        className="absolute inset-0"
                        strokeWidth={1.8}
                        style={{ opacity: unlock }}
                        aria-hidden
                      />
                    </span>
                  }
                  title="Sealed until the final test"
                  description="Spark and Glimmer never see its files, its tasks or its scores."
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PlacePage>
  );
}
