import { engine } from '../../engine/engine';
import * as actions from '../../store/actions';
import { useStore } from '../../store/store';

/** Undo history as a list; click an entry to go back (or forward) to it. */
export function HistoryPalette() {
  useStore((s) => s.historyVersion);
  const entries = engine.history.entries();
  const applied = engine.history.undoCount;
  return (
    <div className="history-list" data-testid="history-list">
      <button className={`history-row ${applied === 0 ? 'current' : ''}`} onClick={() => actions.goToHistory(0)}>
        Initial state
      </button>
      {entries.map((e, i) => (
        <button key={i} className={`history-row ${i < applied ? '' : 'undone'} ${i === applied - 1 ? 'current' : ''}`} onClick={() => actions.goToHistory(i + 1)}>
          {e.label}
        </button>
      ))}
    </div>
  );
}
