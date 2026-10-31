import type { ReactNode } from 'react';
import type { ArmId } from '@architect/shared';
import { RowIcon } from '@architect/ui';
import {
  BookCheck,
  Cpu,
  Crosshair,
  GraduationCap,
  Layers,
  PenLine,
  Pin,
  Repeat,
  School,
  User,
} from 'lucide-react';

const icon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

/** Each arm's mark, on its tile and beside its name in a row. */
export const ARM_ICONS: Record<ArmId, ReactNode> = {
  bare: <User {...icon} />,
  draft: <PenLine {...icon} />,
  targeted: <Crosshair {...icon} />,
  reference: <GraduationCap {...icon} />,
  'reference-targeted': <BookCheck {...icon} />,
  teacher: <School {...icon} />,
  repeat: <Repeat {...icon} />,
  fixed: <Pin {...icon} />,
  'weights-one-shot': <Cpu {...icon} />,
  'weights-targeted': <Layers {...icon} />,
};

/** An arm's mark at the left of a card row. */
export function ArmTile({ arm }: { arm: ArmId }) {
  return <RowIcon>{ARM_ICONS[arm]}</RowIcon>;
}
