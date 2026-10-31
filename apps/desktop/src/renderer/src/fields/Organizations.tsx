import { useEffect, useState } from 'react';
import {
  METHOD_LABELS,
  organizationNoun,
  type FieldView,
  type AddedQualification,
} from '@architect/shared';
import {
  Button,
  Card,
  CardRow,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Segmented,
  Spinner,
  RowIcon,
} from '@architect/ui';
import { Building2, FolderOpen, FolderPlus, Lock, ShieldCheck } from 'lucide-react';
import { api, flowApi } from '../api/client';
import { useGraduates } from '../api/hooks';
import { setQueryData } from '../api/query';
import { shortDate } from '../flow/format';
import { modelNames } from '../flow/names';
import { formatBytes, formatScore, shortPath } from '../lib/format';
import { attempt } from '../lib/notify';
import { fieldKey, type Candidate, type FieldSummary } from './model';
import { plural, Quiet } from './parts';

type TaughtOn = FieldView['organizations'][number];
type Sealed = FieldView['sealed'][number];

/** How often the tab reads the field again while a qualification is running. */
const POLL_MS = 1_500;

const kindWord = (synthetic: boolean | null) =>
  synthetic === null ? null : synthetic ? 'Generated' : 'Real';

/** "Generated · 12 files · 4,210 rows": what an organization the job trains on holds. */
function holds(org: TaughtOn): string {
  const rows = org.files.reduce((sum, file) => sum + (file.rows ?? 0), 0);
  const tables = org.files.some((file) => file.rows !== null);
  return [kindWord(org.synthetic), plural(org.files.length, 'file'), tables && plural(rows, 'row')]
    .filter(Boolean)
    .join(' · ');
}

type Chosen = { kind: 'taught'; index: number } | { kind: 'sealed'; name: string };

/**
 * The organizations of a field: the ones it is taught on, whose files show beside the list, and
 * the sealed ones, which this page names for the person whose they are and shows nothing else
 * of. Their files open only for the final test. A never-seen organization can be added later
 * (decision 085), and each candidate qualified on it beside the list.
 */
export function Organizations({ field }: { field: FieldSummary }) {
  const { view } = field;
  const [chosen, setChosen] = useState<Chosen>({ kind: 'taught', index: 0 });
  const [adding, setAdding] = useState(false);
  const testing = (view.qualifications ?? []).some((item) => item.status === 'testing');
  const jobId = field.job.id;

  useEffect(() => {
    if (!testing) return;
    const timer = setInterval(() => {
      void api.field(jobId).then(
        (next) => setQueryData(fieldKey(jobId), { ...field, view: next }),
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [testing, jobId, field]);

  const open =
    chosen.kind === 'taught' ? (view.organizations[chosen.index] ?? view.organizations[0]) : null;
  const added =
    chosen.kind === 'sealed'
      ? view.sealed.find((org) => org.name === chosen.name && org.addedLater === true)
      : undefined;
  const name = (org: TaughtOn) => org.name ?? 'Its records';
  const canAdd = view.organizations.some((org) => org.id !== null) && view.lockedTestTasks !== null;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <Card title="Organizations" flush>
        {view.organizations.map((org, index) => (
          <CardRow
            key={org.id ?? 'data'}
            icon={
              <RowIcon>
                <Building2 strokeWidth={1.8} aria-hidden />
              </RowIcon>
            }
            title={name(org)}
            detail={holds(org)}
            end="Taught on"
            selected={org === open}
            onClick={() => setChosen({ kind: 'taught', index })}
          />
        ))}
        {view.sealed.map((org) => (
          <CardRow
            key={org.name}
            icon={
              <RowIcon>
                <Lock strokeWidth={1.8} aria-hidden />
              </RowIcon>
            }
            title={org.name}
            detail={[kindWord(org.synthetic), plural(org.files, 'file')].join(' · ')}
            end={org.addedLater === true ? 'Added later' : 'Never seen'}
            {...(org.addedLater === true
              ? {
                  selected: org === added,
                  onClick: () => setChosen({ kind: 'sealed', name: org.name }),
                }
              : {})}
          />
        ))}
        {view.sealed.length > 0 && (
          <Quiet className="border-t border-line pb-4 pt-3 text-small">
            Never seen: kept in the vault, away from teaching, and opened once for the final test.
          </Quiet>
        )}
        {canAdd && (
          <div className="border-t border-line px-4 py-3">
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <FolderPlus size={14} strokeWidth={1.8} aria-hidden />
              Add a never-seen organization
            </Button>
          </div>
        )}
      </Card>
      {open && (
        <Card title={name(open)} flush>
          {open.files.length === 0 ? (
            <Quiet>No files yet</Quiet>
          ) : (
            open.files.map((file) => (
              <CardRow
                key={file.name}
                title={<span className="font-mono text-small">{file.name}</span>}
                end={file.rows === null ? formatBytes(file.bytes) : plural(file.rows, 'row')}
              />
            ))
          )}
        </Card>
      )}
      {added && <QualifyCard field={field} org={added} />}
      {adding && (
        <AddOrganizationDialog
          field={field}
          onClose={() => setAdding(false)}
          onAdded={(org) => {
            setAdding(false);
            setChosen({ kind: 'sealed', name: org });
          }}
        />
      )}
    </div>
  );
}

/** Each candidate of the field on an organization added later: Qualify, its progress, or its score. */
function QualifyCard({ field, org }: { field: FieldSummary; org: Sealed }) {
  const graduates = useGraduates();
  const [asking, setAsking] = useState<string | null>(null);
  const of = (candidate: Candidate): AddedQualification | undefined =>
    field.view.qualifications?.find(
      (item) => item.runId === candidate.run.id && item.org === org.name,
    );
  const agentName = (candidate: Candidate) =>
    graduates.data?.find((graduate) => graduate.id === candidate.run.graduateId)?.name ??
    candidate.report.name;

  const qualify = async (candidate: Candidate) => {
    setAsking(candidate.run.id);
    await attempt(`Couldn't qualify it at ${org.name}`, async () => {
      await flowApi.qualifyAdded(candidate.run.id, org.name);
      const view = await api.field(field.job.id);
      setQueryData(fieldKey(field.job.id), { ...field, view });
    });
    setAsking(null);
  };

  return (
    <Card title={org.name} flush>
      {field.candidates.length === 0 ? (
        <Quiet>No candidate has taken its final test yet</Quiet>
      ) : (
        field.candidates.map((candidate) => {
          const done = of(candidate);
          const label = `${agentName(candidate)}, tested ${shortDate(candidate.report.createdAt)}`;
          return (
            <CardRow
              key={candidate.run.id}
              icon={
                <RowIcon>
                  <ShieldCheck strokeWidth={1.8} aria-hidden />
                </RowIcon>
              }
              title={label}
              detail={[
                METHOD_LABELS[candidate.report.method],
                `version ${candidate.run.currentVersion}`,
                done?.status === 'paused' ? done.error : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              end={
                done?.status === 'finished' && done.score ? (
                  <span
                    className="tabular-nums"
                    aria-label={`${label} at ${org.name}: ${done.score.pass} of ${done.score.total}`}
                  >
                    {formatScore(done.score)}
                  </span>
                ) : done?.status === 'testing' ? (
                  <span className="flex items-center gap-2 text-small">
                    <Spinner size={14} />
                    Qualifying
                  </span>
                ) : (
                  <Button
                    size="sm"
                    loading={asking === candidate.run.id}
                    aria-label={`Qualify ${label} at ${org.name}`}
                    onClick={() => void qualify(candidate)}
                  >
                    Qualify
                  </Button>
                )
              }
            />
          );
        })
      )}
      {field.candidates.length > 0 && (
        <Quiet className="border-t border-line pb-4 pt-3 text-small">
          Qualify: the version takes its final test here once, with no{' '}
          {modelNames(field.job).mentor}, and the result joins its report.
        </Quiet>
      )}
    </Card>
  );
}

/**
 * Seals a never-seen organization into the field from a folder of its records: its name, whether
 * its records are generated or real, and the folder. The engine checks the folder against the
 * field's files and seals it beside the field's final test.
 */
function AddOrganizationDialog({
  field,
  onClose,
  onAdded,
}: {
  field: FieldSummary;
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'generated' | 'real'>('real');
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = organizationNoun(field.job);

  const pick = async () => {
    const picked = await attempt("Couldn't open the folder picker", () =>
      flowApi.pickFiles({ title: `Choose the ${noun}'s records folder`, directory: true }),
    );
    const chosen = picked?.[0];
    if (!chosen) return;
    setFolder(chosen);
    if (name.trim() === '') setName(chosen.split(/[\\/]/).pop() ?? '');
  };

  const add = async () => {
    if (folder === null) return;
    setBusy(true);
    const view = await attempt(`Couldn't add ${name.trim()}`, () =>
      flowApi.addOrganization(field.job.id, {
        folder,
        name: name.trim(),
        synthetic: kind === 'generated',
      }),
    );
    setBusy(false);
    if (!view) return;
    setQueryData(fieldKey(field.job.id), { ...field, view });
    onAdded(name.trim());
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title="Add a never-seen organization"
        description={`Kept beside the final test. ${modelNames(field.job).mentor} never sees it.`}
      >
        <div className="flex flex-col gap-5 px-6 pt-5">
          <Button size="md" className="self-start" onClick={() => void pick()}>
            <FolderOpen size={16} strokeWidth={1.8} aria-hidden />
            {folder === null ? 'Choose a folder' : shortPath(folder)}
          </Button>
          <Field label="Name" htmlFor="added-org-name">
            <Input
              id="added-org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Maple Grove Academy"
            />
          </Field>
          <Segmented
            aria-label="Its records"
            options={[
              { value: 'real', label: 'Real' },
              { value: 'generated', label: 'Generated' },
            ]}
            value={kind}
            onValueChange={setKind}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button
            size="md"
            variant="primary"
            loading={busy}
            disabled={folder === null || name.trim() === ''}
            onClick={() => void add()}
          >
            Add and seal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
