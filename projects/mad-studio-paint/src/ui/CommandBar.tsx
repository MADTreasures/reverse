import { isElectron } from '../platform/platform';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/store';
import { useShortcuts } from '../store/shortcutStore';
import { commandById, isEnabled, runCommand, shortcutLabel } from './commands';
import { Icon } from './controls/Icons';

type Group = [string, string][];

/** Command bar of the default workspace. */
const DEFAULT_GROUPS: Group[] = [
  [
    ['new', 'new'],
    ['open', 'open'],
    ['save', 'save'],
  ],
  [
    ['undo', 'undo'],
    ['redo', 'redo'],
  ],
  [
    ['clear', 'clear'],
    ['fill', 'fillCommand'],
    ['transform', 'transform'],
  ],
  [['flipViewH', 'flipH']],
  [['shortcuts', 'help']],
];

/** Command bar of the classic workspace. */
const CLASSIC_GROUPS: Group[] = [
  [
    ['new', 'new'],
    ['open', 'open'],
    ['save', 'save'],
  ],
  [
    ['undo', 'undo'],
    ['redo', 'redo'],
  ],
  [
    ['clear', 'clear'],
    ['clearOutside', 'clearOutside'],
    ['fill', 'fillCommand'],
    ['transform', 'transform'],
  ],
  [
    ['deselect', 'deselect'],
    ['invertSelection', 'invertSelection'],
    ['selectionBorder', 'border'],
  ],
  [
    ['snapRuler', 'snapRuler'],
    ['snapSpecial', 'snapSpecial'],
  ],
  [['shortcuts', 'help']],
];

/** The Mac app has no separate title bar: the document title sits at the end of the command bar. */
function WindowTitle() {
  const doc = useStore((s) => s.doc);
  const dirty = useStore((s) => s.dirty);
  const zoom = useStore((s) => s.view.zoom);
  return (
    <span className="window-title">
      {doc.name}
      {dirty ? '*' : ''} ({doc.width} x {doc.height}px {doc.dpi}dpi {Math.round(zoom * 1000) / 10}%)
    </span>
  );
}

/** Quick-access icon row under the menu bar. */
export function CommandBar() {
  useStore(useShallow((s) => [s.canUndo, s.canRedo, s.selection, s.activeLayerId, s.doc, s.transforming, s.view.flipH, s.showSelectionBorder, s.snapRuler, s.snapSpecial, s.tool, s.selectedRuler]));
  const transforming = useStore((s) => s.transforming);
  useShortcuts((s) => s.overrides);
  const workspace = useStore((s) => s.workspace);
  const groups = workspace === 'classic' ? CLASSIC_GROUPS : DEFAULT_GROUPS;
  return (
    <div className={`command-bar ${isElectron ? 'electron' : ''}`} role="toolbar" aria-label="Command bar">
      {groups.map((g, i) => (
        <div key={i} className="cmd-group">
          {g.map(([id, icon]) => {
            const c = commandById(id)!;
            const sc = shortcutLabel(id);
            return (
              <button
                key={id}
                className={`icon-btn cmd ${c.checked?.() ? 'on' : ''}`}
                title={sc ? `${c.label} (${sc})` : c.label}
                aria-label={c.label}
                aria-pressed={c.checked ? c.checked() : undefined}
                disabled={!isEnabled(c)}
                onClick={() => void runCommand(id)}
              >
                <Icon name={icon} />
              </button>
            );
          })}
        </div>
      ))}
      {isElectron && <WindowTitle />}
      {transforming && (
        <div className="cmd-group transform-actions">
          <button className="btn primary small" onClick={() => void runCommand('confirmTransform')}>
            OK
          </button>
          <button className="btn small" onClick={() => void runCommand('cancelTransform')}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
