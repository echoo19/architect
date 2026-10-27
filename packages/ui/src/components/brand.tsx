import { cn } from '../lib/cn';

export interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** The Architect mark: a rounded square with an A. Decorative; pair it with the name. */
export function LogoMark({ size = 20, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size >= 40 ? 1.4 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M8 16 12 8l4 8" />
    </svg>
  );
}

export type AgentAvatarSize = 'sm' | 'md' | 'lg';

const avatarSize: Record<AgentAvatarSize, string> = {
  sm: 'size-[18px] rounded-[5px] text-2xs',
  md: 'size-5 rounded-[6px] text-2xs',
  lg: 'size-12 rounded-xl text-2xl',
};

export interface AgentAvatarProps {
  name: string;
  size?: AgentAvatarSize;
  className?: string;
}

/** A graduate's initial on the student tint. Decorative; the name is always shown beside it. */
export function AgentAvatar({ name, size = 'sm', className }: AgentAvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || 'A';
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-student-tint font-semibold leading-none text-student',
        avatarSize[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}
