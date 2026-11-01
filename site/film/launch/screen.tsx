import type { CSSProperties, ReactNode } from 'react';
import { ACADEMY } from '../lab/data';
import { FlowHeader, SIDEBAR, Sidebar, WINDOW, type SidebarState } from '../lab/shell';
import { clamp } from '../lab/time';

/**
 * One window of Architect Lab, built from the walkthrough's own parts: the sidebar, the guided
 * flow's bar, a page or two while one gives way to the next, and the counterexample's drawer. The
 * launch film says what each shows at a moment; this only puts them in their places.
 */

export type Mode = 'place' | 'flow' | 'bare';

export interface Layer {
  key: string;
  mode: Mode;
  node: ReactNode;
  /** How far the page has come in and gone, from 0 to 1 each. */
  enter: number;
  leave: number;
}

export interface ScreenView {
  layers: readonly Layer[];
  sidebar: SidebarState;
  /** How much of the sidebar is in: it slides away for the guided flow and the first screen. */
  sidebarShown: number;
  /** The flow's bar: how much of it is in, and its step. */
  flow: { shown: number; step: number };
  /** The round's drawer: what it shows, and how far it has opened and closed. */
  drawer?: { node: ReactNode; open: number; close: number };
}

export const RIM = 'inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 30px 80px rgb(0 0 0 / 0.5)';

export function Screen({
  view,
  style,
  children,
}: {
  view: ScreenView;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const { layers, sidebar, sidebarShown, flow, drawer } = view;
  return (
    <div
      className="absolute overflow-hidden rounded-[14px] bg-ground"
      style={{ width: WINDOW.width, height: WINDOW.height, boxShadow: RIM, ...style }}
    >
      {layers.map((layer) => {
        if (layer.enter <= 0 || layer.leave >= 1) return null;
        return (
          <div
            key={layer.key}
            data-page={layer.key}
            className="absolute overflow-hidden"
            style={{
              left: layer.mode === 'place' ? SIDEBAR * sidebarShown : 0,
              top: layer.mode === 'flow' ? 56 : 0,
              right: 0,
              bottom: 0,
              opacity: layer.enter * (1 - layer.leave),
              transform: `translateY(${(1 - layer.enter) * 10}px)`,
            }}
          >
            {layer.node}
          </div>
        );
      })}
      {flow.shown > 0 && (
        <FlowHeader
          title={ACADEMY}
          step={flow.step}
          style={{ opacity: flow.shown, transform: `translateY(${(1 - flow.shown) * -12}px)` }}
        />
      )}
      {sidebarShown > 0 && (
        <Sidebar
          state={sidebar}
          style={{
            transform: `translateX(${(sidebarShown - 1) * SIDEBAR}px)`,
            opacity: sidebarShown,
          }}
        />
      )}
      {drawer && drawer.open > 0 && drawer.close < 1 && (
        // The app's drawer darkens what it opens over, so the drawer is the one thing in view.
        <div
          aria-hidden
          className="absolute inset-0 bg-backdrop"
          style={{ opacity: clamp(drawer.open * 1.5) * (1 - drawer.close), zIndex: 15 }}
        />
      )}
      {drawer && drawer.open > 0 && drawer.close < 1 && (
        <div
          data-frame="drawer"
          className="absolute bottom-3 right-3 top-[68px] w-[500px] overflow-hidden rounded-card bg-raised shadow-float"
          style={{
            transform: `translateX(${(1 - drawer.open + drawer.close) * 540}px)`,
            opacity: clamp(drawer.open * 3) * (1 - drawer.close),
            zIndex: 20,
          }}
        >
          {drawer.node}
        </div>
      )}
      {children}
    </div>
  );
}

/** The sidebar as a place page has it: its place selected, the agents in, nothing scrolled. */
export function placeSidebar(fillTop: number, fillHeight = 40, extra?: Partial<SidebarState>) {
  return { fillTop, fillHeight, fill: 1, chat: 0, agents: 1, rest: 1, ...extra };
}
