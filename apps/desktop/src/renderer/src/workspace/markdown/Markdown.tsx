import { Fragment, memo, type ReactNode } from 'react';
import {
  cn,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { parseMarkdown, type Align, type Block, type Inline } from './parse';

const ALIGN: Record<Exclude<Align, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const alignClass = (align: Align | undefined) => (align ? ALIGN[align] : undefined);

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'break':
        return <br key={index} />;
      case 'code':
        return (
          <code key={index} className="rounded-mark bg-hover px-1.5 py-px font-mono text-[0.875em]">
            {node.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={index} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        );
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'del':
        return (
          <del key={index} className="text-fg">
            {renderInline(node.children)}
          </del>
        );
    }
  });
}

const HEADING_SIZE = ['text-h2', 'text-body'];

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p key={index} className="m-0 text-pretty">
          {renderInline(block.children)}
        </p>
      );
    case 'heading': {
      const Tag = block.level <= 2 ? 'h3' : 'h4';
      return (
        <Tag key={index} className={cn('m-0 font-semibold', HEADING_SIZE[block.level - 1])}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <div className="flex flex-col gap-2">{item.map(renderBlock)}</div>
        </li>
      ));
      const list = 'm-0 space-y-1.5 pl-6 marker:text-fg';
      return block.ordered ? (
        <ol key={index} start={block.start} className={cn(list, 'list-decimal')}>
          {items}
        </ol>
      ) : (
        <ul key={index} className={cn(list, 'list-disc')}>
          {items}
        </ul>
      );
    }
    case 'code':
      return (
        <pre
          key={index}
          className="m-0 overflow-x-auto rounded-control bg-field px-4 py-3 font-mono text-small leading-relaxed text-fg shadow-edge"
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <TableCard key={index}>
          <TableHeader>
            <TableRow>
              {block.head.map((cell, column) => (
                <TableHead key={column} className={alignClass(block.align[column])}>
                  {renderInline(cell)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.map((row, r) => (
              <TableRow key={r}>
                {row.map((cell, column) => (
                  <TableCell key={column} className={alignClass(block.align[column])}>
                    {renderInline(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </TableCard>
      );
    case 'quote':
      return (
        <blockquote
          key={index}
          className="m-0 flex flex-col gap-2 border-l-2 border-line-strong pl-4 text-fg"
        >
          {block.children.map(renderBlock)}
        </blockquote>
      );
    case 'rule':
      return <hr key={index} className="m-0 border-0 border-t border-line" />;
  }
}

export interface MarkdownProps {
  /** Markdown from the agent. Raw HTML in it shows as text. */
  text: string;
  className?: string;
}

/** An agent's reply, rendered from Markdown. */
export const Markdown = memo(function Markdown({ text, className }: MarkdownProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3.5', className)}>
      {parseMarkdown(text).map(renderBlock)}
    </div>
  );
});
