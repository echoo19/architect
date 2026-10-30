import { Children, createContext, useContext, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { springs } from './springs';

/** How far an item rises as it appears. */
export const REVEAL_RISE = 12;
/** The gap between one staggered item and the next, in seconds. */
export const STAGGER_STEP = 0.03;
/** Items past this many appear together with the last staggered one. */
export const STAGGER_LIMIT = 8;

/** When an item of a staggered list starts, in seconds: 30ms apart, the ninth with the eighth. */
export function staggerDelay(
  index: number,
  step: number = STAGGER_STEP,
  limit: number = STAGGER_LIMIT,
): number {
  return Math.min(Math.max(index, 0), limit - 1) * step;
}

const tags = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
  span: motion.span,
  p: motion.p,
  ul: motion.ul,
  ol: motion.ol,
} as const;

type RevealTag = keyof typeof tags;

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds to wait before it appears. */
  delay?: number;
  as?: RevealTag;
}

/** Fades in and rises 12px as it mounts: what a section or a row does on its first appearance. */
export function Reveal({ children, className, delay = 0, as = 'div' }: RevealProps) {
  const Tag = tags[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: REVEAL_RISE }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.smooth, delay }}
    >
      {children}
    </Tag>
  );
}

const StaggerIndex = createContext(0);

const containers = { div: 'div', ul: 'ul', ol: 'ol', section: 'section' } as const;

export interface StaggerProps {
  children: ReactNode;
  className?: string;
  as?: keyof typeof containers;
}

/**
 * A group whose children appear one after another. Each direct child is a `StaggerItem`, which
 * takes its turn from its place in the group.
 */
export function Stagger({ children, className, as = 'div' }: StaggerProps) {
  const Tag = containers[as];
  return (
    <Tag className={className}>
      {Children.map(children, (child, index) => (
        <StaggerIndex.Provider value={index}>{child}</StaggerIndex.Provider>
      ))}
    </Tag>
  );
}

export interface StaggerItemProps extends Omit<RevealProps, 'delay'> {
  /** Its place in the group, when it is not a direct child of `Stagger`. */
  index?: number;
}

export function StaggerItem({ index, ...props }: StaggerItemProps) {
  const inherited = useContext(StaggerIndex);
  return <Reveal {...props} delay={staggerDelay(index ?? inherited)} />;
}
