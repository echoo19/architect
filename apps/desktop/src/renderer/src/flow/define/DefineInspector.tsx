import type { ReactNode } from 'react';
import { Inspector, type InspectorTab } from '@architect/ui';
import { Bot, ClipboardCheck, GraduationCap, NotebookPen, Wallet } from 'lucide-react';
import { BudgetTab } from './BudgetTab';
import { EvaluationTab } from './EvaluationTab';
import type { FinalTestState } from './final-test';
import { DEFINE_TABS, INSPECTOR_NAME, tabLabel, type DefineTab } from './inspector-tabs';
import { StudentTab } from './StudentTab';
import { TeacherTab } from './TeacherTab';
import { TeachingTab } from './TeachingTab';
import type { JobEditor } from './use-job-editor';
import { useUndoableChange } from './use-undo';

const ICONS: Record<DefineTab, ReactNode> = {
  teacher: <GraduationCap strokeWidth={1.7} aria-hidden />,
  student: <Bot strokeWidth={1.7} aria-hidden />,
  teaching: <NotebookPen strokeWidth={1.7} aria-hidden />,
  evaluation: <ClipboardCheck strokeWidth={1.7} aria-hidden />,
  budget: <Wallet strokeWidth={1.7} aria-hidden />,
};

/** The name the Define inspector keeps its tab and fold under. */
const REMEMBER_AS = 'define';

interface DefineInspectorProps {
  open: boolean;
  /** The tab something on the page asked for; the inspector keeps its own until then. */
  tab: DefineTab | undefined;
  onTabChange: (tab: DefineTab) => void;
  editor: JobEditor;
  /** How many tasks the job holds, when known: once it holds any, they were split. */
  taskCount: number | null;
  /** Where the final test runs: the run's own choice, which the job doesn't keep. */
  finalTest: FinalTestState;
}

/**
 * The job's settings at the right of Define: the teacher, the agent's model, how it is taught,
 * how it is measured, and the budget. Every control is a field the engine checks; none can show
 * the teacher a sealed organization or let it change the grading, the sets or the permissions.
 * Each change is saved as it is made, with Undo.
 */
export function DefineInspector({
  open,
  tab,
  onTabChange,
  editor,
  taskCount,
  finalTest,
}: DefineInspectorProps) {
  const change = useUndoableChange(editor);
  const tabs: InspectorTab<DefineTab>[] = DEFINE_TABS.map((value) => ({
    value,
    label: tabLabel(value, editor.job),
    icon: ICONS[value],
  }));
  const props = { editor, change };
  return (
    <Inspector
      aria-label={INSPECTOR_NAME}
      tabs={tabs}
      rememberAs={REMEMBER_AS}
      tab={tab}
      onTabChange={onTabChange}
      open={open}
      // Room for the five tabs' names, the models' among them, without cutting any.
      width={400}
    >
      {(shown) => {
        switch (shown) {
          case 'teacher':
            return <TeacherTab {...props} />;
          case 'student':
            return <StudentTab {...props} />;
          case 'teaching':
            return <TeachingTab {...props} testPlace={finalTest.place} />;
          case 'evaluation':
            return <EvaluationTab {...props} taskCount={taskCount} finalTest={finalTest} />;
          case 'budget':
            return <BudgetTab {...props} testPlace={finalTest.place} />;
        }
      }}
    </Inspector>
  );
}
