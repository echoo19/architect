import { cn } from '../lib/cn';

export type SpinnerTone = 'mentor' | 'student' | 'neutral';

const arcTone: Record<SpinnerTone, string> = {
  mentor: 'stroke-mentor',
  student: 'stroke-student',
  neutral: 'stroke-fg',
};

export interface SpinnerProps {
  /** Mentor (amber) while training, student (blue) while an agent works. */
  tone?: SpinnerTone;
  size?: number;
  /** Announced to assistive tech. Without it the spinner is decorative. */
  label?: string;
  className?: string;
}

/** A ring with a moving arc. For activity only; loading layouts use Skeleton. */
export function Spinner({ tone = 'neutral', size = 14, label, className }: SpinnerProps) {
  const stroke = size <= 13 ? 3 : 2.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('shrink-0 animate-spin', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <circle cx="12" cy="12" r="9" className="stroke-line-strong" strokeWidth={stroke} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        className={arcTone[tone]}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}
