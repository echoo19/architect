import { Slider as RadixSlider } from 'radix-ui';
import { cn } from '../lib/cn';

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Read out instead of the raw number, e.g. "$5". */
  'aria-valuetext'?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  id,
  disabled,
  className,
  ...aria
}: SliderProps) {
  return (
    <RadixSlider.Root
      id={id}
      value={[value]}
      onValueChange={([next]) => {
        if (next !== undefined) onValueChange(next);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        'relative flex h-5 w-full touch-none select-none items-center data-[disabled]:opacity-40',
        className,
      )}
    >
      <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-line-strong">
        <RadixSlider.Range className="absolute h-full rounded-full bg-fg" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        {...aria}
        className="block size-4 rounded-full bg-fg transition-transform duration-150 hover:scale-110"
      />
    </RadixSlider.Root>
  );
}
