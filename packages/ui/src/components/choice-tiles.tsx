import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import { cn } from '../lib/cn';
import { PRESS_SCALE, springs } from '../motion/springs';

export interface ChoiceTile<T extends string> {
  value: T;
  label: string;
  /** A 16px Lucide icon, at the tile's top left. */
  icon: ReactNode;
  disabled?: boolean;
}

interface ChoiceTilesBase<T extends string> {
  options: readonly ChoiceTile<T>[];
  'aria-label': string;
  /** Tiles per row. Three suit an inspector; more suit a page. */
  columns?: 2 | 3 | 4;
  disabled?: boolean;
  className?: string;
}

export interface SingleChoiceTilesProps<T extends string> extends ChoiceTilesBase<T> {
  multiple?: false;
  value: T;
  onValueChange: (value: T) => void;
}

export interface MultipleChoiceTilesProps<T extends string> extends ChoiceTilesBase<T> {
  multiple: true;
  value: readonly T[];
  onValueChange: (value: T[]) => void;
}

export type ChoiceTilesProps<T extends string> =
  SingleChoiceTilesProps<T> | MultipleChoiceTilesProps<T>;

const COLUMNS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const;

/**
 * Choices as icon tiles, such as the teacher's model or what the teacher may change. One may be
 * chosen, or several with `multiple`. The arrow keys move between tiles, Space or Enter chooses.
 */
export function ChoiceTiles<T extends string>(props: ChoiceTilesProps<T>) {
  const { options, columns = 3, disabled, className } = props;
  const known = (value: string): value is T => options.some((option) => option.value === value);
  const shared = {
    'aria-label': props['aria-label'],
    disabled,
    className: cn('grid gap-2', COLUMNS[columns], className),
  };
  const tiles = options.map((option) => (
    <Tile
      key={option.value}
      option={option}
      chosen={props.multiple ? props.value.includes(option.value) : props.value === option.value}
    />
  ));

  if (props.multiple) {
    return (
      <ToggleGroup.Root
        type="multiple"
        value={[...props.value]}
        onValueChange={(next) => props.onValueChange(next.filter(known))}
        {...shared}
      >
        {tiles}
      </ToggleGroup.Root>
    );
  }
  return (
    <ToggleGroup.Root
      type="single"
      value={props.value}
      // A single group keeps one tile chosen: choosing the chosen one again changes nothing.
      onValueChange={(next) => {
        if (known(next)) props.onValueChange(next);
      }}
      {...shared}
    >
      {tiles}
    </ToggleGroup.Root>
  );
}

function Tile<T extends string>({ option, chosen }: { option: ChoiceTile<T>; chosen: boolean }) {
  return (
    <ToggleGroup.Item value={option.value} disabled={option.disabled} asChild>
      <motion.button
        type="button"
        whileTap={{ scale: PRESS_SCALE }}
        transition={springs.snappy}
        className={cn(
          'flex min-h-[68px] min-w-0 flex-col items-start justify-between gap-2 rounded-control',
          'bg-field px-3 py-2.5 text-left text-ui shadow-edge',
          'transition-[background-color,box-shadow] duration-150 hover:bg-hover',
          'disabled:pointer-events-none disabled:opacity-40',
          chosen && 'bg-selected shadow-edge-strong inset-ring-1 inset-ring-fg/50',
        )}
      >
        <span aria-hidden className="flex [&_svg]:size-4">
          {option.icon}
        </span>
        <span className="line-clamp-2 w-full break-words font-medium">{option.label}</span>
      </motion.button>
    </ToggleGroup.Item>
  );
}
