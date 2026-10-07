import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { IconClose, IconMaximize } from '../controls/Icons';
import { closeWindow, focusWindow, moveWindow, resizeWindow, toggleMaximize } from './windows';

interface WindowFrameProps {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  /** Controls shown in the title bar, right of the title. */
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: string;
}

/** Floating, movable and resizable window inside the workspace. */
export function WindowFrame({ id, title, icon, toolbar, children, className = '', accent }: WindowFrameProps) {
  const win = useStore((s) => s.ui.windows[id]);
  const focused = useStore((s) => s.ui.focusedWindow === id);
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; wx: number; wy: number; ww: number; wh: number; edges: string } | null>(null);

  if (!win?.open) return null;

  const start = (e: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize', edges = '') => {
    if (e.button !== 0 || (mode === 'move' && win.maximized)) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    focusWindow(id);
    drag.current = { mode, x: e.clientX, y: e.clientY, wx: win.x, wy: win.y, ww: win.w, wh: win.h, edges };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === 'move') moveWindow(id, d.wx + dx, d.wy + dy);
    else {
      const w = d.edges.includes('r') ? d.ww + dx : d.ww;
      const h = d.edges.includes('b') ? d.wh + dy : d.wh;
      resizeWindow(id, w, h);
    }
  };
  const end = () => {
    drag.current = null;
  };

  const style = win.maximized
    ? { left: 0, top: 0, right: 0, bottom: 0, zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <section
      className={`window ${focused ? 'focused' : ''} ${win.maximized ? 'maximized' : ''} ${className}`}
      style={style}
      data-window={id}
      onPointerDownCapture={() => focusWindow(id)}
    >
      <header
        className="window-title"
        style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
        onPointerDown={(e) => start(e, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.window-toolbar')) return;
          toggleMaximize(id);
        }}
      >
        {icon && <span className="window-icon">{icon}</span>}
        <span className="window-name">{title}</span>
        <div className="window-toolbar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {toolbar}
        </div>
        <div className="window-buttons" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn" data-hint="Maximize / restore (double-click the title bar)" onClick={() => toggleMaximize(id)}>
            <IconMaximize size={11} />
          </button>
          <button className="icon-btn" data-hint="Close window" onClick={() => closeWindow(id)}>
            <IconClose size={12} />
          </button>
        </div>
      </header>
      <div className="window-body">{children}</div>
      {!win.maximized && (
        <>
          <div className="resize-r" onPointerDown={(e) => start(e, 'resize', 'r')} onPointerMove={move} onPointerUp={end} />
          <div className="resize-b" onPointerDown={(e) => start(e, 'resize', 'b')} onPointerMove={move} onPointerUp={end} />
          <div className="resize-rb" onPointerDown={(e) => start(e, 'resize', 'rb')} onPointerMove={move} onPointerUp={end} />
        </>
      )}
    </section>
  );
}
