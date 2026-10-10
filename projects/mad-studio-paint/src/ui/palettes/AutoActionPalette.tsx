/**
 * Auto Action palette, like the reference's: the auto action set (switch, create new), its auto
 * actions with their recorded commands (run switch, change settings switch, the settings each
 * command keeps), and Start / Stop recording, Play, Add and Delete. Auto actions and commands are
 * reordered by dragging (commands also into other auto actions); auto actions can be dropped on the
 * Quick Access palette, and auto action set files on this one. The palette menu manages sets and
 * auto actions, moves or copies them to other sets, and switches Button mode and the bars.
 */
import { useState, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { stepDetails, type AutoAction } from '../../paint/autoActions';
import {
  createActionSet,
  currentSet,
  deleteActionSet,
  deleteSelected,
  duplicateActionSet,
  duplicateAutoAction,
  duplicateCommand,
  exportActionSet,
  importActionSet,
  moveAutoAction,
  moveCommand,
  newAutoAction,
  playAction,
  renameActionSet,
  renameAutoAction,
  selectAction,
  selectSet,
  sendAutoActionToSet,
  setActionEnabled,
  setStepSwitch,
  toggleActionExpanded,
  toggleAutoActionView,
  toggleRecording,
  useAutoActions,
} from '../../store/autoActionStore';
import { confirmDialog, promptDialog, type MenuItem } from '../overlays';
import { Icon } from '../controls/Icons';
import { QUICK_ITEM_MIME } from '../quickItems';

const ACTION_MIME = 'application/x-mad-auto-action';
const STEP_MIME = 'application/x-mad-auto-step';

/** The palette menu (≡). */
export function autoActionMenu(): MenuItem[] {
  const s = useAutoActions.getState();
  const set = currentSet(s);
  const action = set?.actions.find((a) => a.id === s.selected);
  const others = s.sets.filter((x) => x.id !== set?.id);
  return [
    {
      label: 'Create new set…',
      onClick: async () => {
        const name = await promptDialog('Create new set', 'Set');
        if (name) createActionSet(name);
      },
    },
    { label: 'Duplicate set', onClick: () => duplicateActionSet() },
    {
      label: 'Settings of set…',
      onClick: async () => {
        const name = await promptDialog('Settings of set', set?.name ?? '');
        if (name) renameActionSet(name);
      },
    },
    { label: 'Delete set', onClick: () => void deleteSetAsked(), disabled: !(s.sets.length > 1) },
    { label: 'Import set…', onClick: () => void importActionSet() },
    { label: 'Export set…', onClick: () => void exportActionSet(), disabled: !set },
    { separator: true },
    { label: 'Add auto action', onClick: () => void addNamed() },
    { label: 'Duplicate auto action', onClick: () => duplicateAutoAction(), disabled: !action },
    { label: 'Duplicate command', onClick: duplicateCommand, disabled: !s.selectedStep },
    {
      label: 'Rename auto action…',
      disabled: !action,
      onClick: async () => {
        if (!action) return;
        const name = await promptDialog('Rename auto action', action.name);
        if (name) renameAutoAction(action.id, name);
      },
    },
    { label: 'Move auto action to a different set', disabled: !action || !others.length, submenu: others.map((o) => ({ label: o.name, onClick: () => sendAutoActionToSet(o.id, false) })) },
    { label: 'Copy auto action to different set', disabled: !action || !others.length, submenu: others.map((o) => ({ label: o.name, onClick: () => sendAutoActionToSet(o.id, true) })) },
    { label: 'Delete auto action', onClick: () => void deleteAsked(), disabled: !action },
    { separator: true },
    { label: 'Button mode', checked: s.buttonMode, onClick: () => toggleAutoActionView('buttonMode') },
    { label: 'Show the action setting bar', checked: s.settingBar, onClick: () => toggleAutoActionView('settingBar') },
    { label: 'Show command bar', checked: s.commandBar, onClick: () => toggleAutoActionView('commandBar') },
  ];
}

async function addNamed(): Promise<void> {
  const name = await promptDialog('Add auto action', 'Auto action');
  if (name) newAutoAction(name);
}

/** Delete auto action: the selected command or auto action, after OK. */
async function deleteAsked(): Promise<void> {
  const s = useAutoActions.getState();
  const action = currentSet(s)?.actions.find((a) => a.id === s.selected);
  if (!action) return;
  const step = action.steps.find((st) => st.id === s.selectedStep);
  if (await confirmDialog('Delete auto action', step ? `Delete the command "${step.label}" of "${action.name}"?` : `Delete the auto action "${action.name}"?`, 'OK')) deleteSelected();
}

async function deleteSetAsked(): Promise<void> {
  const set = currentSet();
  if (set && (await confirmDialog('Delete set', `Delete the auto action set "${set.name}"?`, 'OK'))) deleteActionSet();
}

/** Before or after a row (its lower half). */
const below = (e: DragEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
};

function ActionRow({ a, index, steps }: { a: AutoAction; index: number; steps: number }) {
  const { selected, selectedStep, expanded, recording } = useAutoActions(useShallow((s) => ({ selected: s.selected, selectedStep: s.selectedStep, expanded: s.expanded.includes(a.id), recording: s.recording })));
  const [mark, setMark] = useState<string | null>(null);
  const allOn = a.steps.length > 0 && a.steps.every((st) => st.enabled);
  const anyDialog = a.steps.some((st) => st.showDialog);
  /** Drops on the auto action row: an auto action before / after it, a command at its end (or first). */
  const onDrop = (e: DragEvent<HTMLElement>) => {
    setMark(null);
    const t = e.dataTransfer.types;
    if (t.includes(ACTION_MIME)) {
      e.preventDefault();
      moveAutoAction(e.dataTransfer.getData(ACTION_MIME), below(e) ? index + 1 : index);
    } else if (t.includes(STEP_MIME)) {
      e.preventDefault();
      const d = JSON.parse(e.dataTransfer.getData(STEP_MIME)) as { action: string; step: string };
      moveCommand(d.action, d.step, a.id, below(e) ? steps : 0);
    }
  };
  return (
    <>
      <div
        className={`action-row ${selected === a.id && !selectedStep ? 'on' : ''} ${recording === a.id ? 'recording' : ''} ${mark ?? ''}`}
        role="treeitem"
        aria-selected={selected === a.id && !selectedStep}
        aria-label={a.name}
        aria-expanded={expanded}
        draggable={!recording}
        onDragStart={(e) => {
          e.dataTransfer.setData(ACTION_MIME, a.id);
          e.dataTransfer.setData(QUICK_ITEM_MIME, JSON.stringify({ kind: 'action', id: a.id }));
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ACTION_MIME) && !e.dataTransfer.types.includes(STEP_MIME)) return;
          e.preventDefault();
          setMark(below(e) ? 'drop-after' : 'drop-before');
        }}
        onDragLeave={() => setMark(null)}
        onDrop={onDrop}
        onClick={() => selectAction(a.id)}
        onDoubleClick={() => void playAction(a.id, null)}
      >
        <input type="checkbox" aria-label={`Run ${a.name}`} checked={allOn} disabled={!a.steps.length} onClick={(e) => e.stopPropagation()} onChange={(e) => setActionEnabled(a.id, e.target.checked)} />
        <span className={`dialog-switch ${anyDialog ? 'on' : ''}`} title={anyDialog ? 'Some commands open their dialog' : ''} />
        <button
          className="folder-twist"
          aria-label={expanded ? 'Hide commands' : 'Show commands'}
          onClick={(e) => {
            e.stopPropagation();
            toggleActionExpanded(a.id);
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="action-name">{a.name}</span>
        {recording === a.id && <span className="rec-dot" aria-label="Recording" />}
      </div>
      {expanded && a.steps.map((st, i) => <StepRow key={st.id} a={a} index={i} />)}
    </>
  );
}

function StepRow({ a, index }: { a: AutoAction; index: number }) {
  const st = a.steps[index];
  const { on, recording } = useAutoActions(useShallow((s) => ({ on: s.selected === a.id && s.selectedStep === st.id, recording: s.recording })));
  const [mark, setMark] = useState<string | null>(null);
  return (
    <div>
      <div
        className={`action-row step ${on ? 'on' : ''} ${mark ?? ''}`}
        role="treeitem"
        aria-selected={on}
        aria-label={st.label}
        draggable={!recording}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(STEP_MIME, JSON.stringify({ action: a.id, step: st.id }));
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(STEP_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          setMark(below(e) ? 'drop-after' : 'drop-before');
        }}
        onDragLeave={() => setMark(null)}
        onDrop={(e) => {
          setMark(null);
          if (!e.dataTransfer.types.includes(STEP_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          const d = JSON.parse(e.dataTransfer.getData(STEP_MIME)) as { action: string; step: string };
          moveCommand(d.action, d.step, a.id, below(e) ? index + 1 : index);
        }}
        onClick={() => selectAction(a.id, st.id)}
      >
        <input type="checkbox" aria-label={`Run ${st.label}`} checked={st.enabled} onClick={(e) => e.stopPropagation()} onChange={(e) => setStepSwitch(a.id, st.id, { enabled: e.target.checked })} />
        <input
          type="checkbox"
          className="dialog-check"
          title="Show the dialog when played (change settings)"
          aria-label={`Change settings of ${st.label}`}
          checked={st.showDialog}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setStepSwitch(a.id, st.id, { showDialog: e.target.checked })}
        />
        <span className="action-name">{st.label}</span>
      </div>
      {stepDetails(st.op).map((line) => (
        <div key={line} className="action-detail">
          {line}
        </div>
      ))}
    </div>
  );
}

export function AutoActionPalette() {
  const { sets, current, recording, playing, selected, buttonMode, settingBar, commandBar } = useAutoActions(
    useShallow((s) => ({ sets: s.sets, current: s.current, recording: s.recording, playing: s.playing, selected: s.selected, buttonMode: s.buttonMode, settingBar: s.settingBar, commandBar: s.commandBar })),
  );
  const set = sets.find((s) => s.id === current) ?? sets[0];
  return (
    <div
      className="auto-action-palette"
      data-testid="auto-action-palette"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      // Auto action set files dropped here are imported.
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => /\.(madactions|json)$/i.test(x.name));
        if (!f) return;
        e.preventDefault();
        void f.arrayBuffer().then((b) => importActionSet({ name: f.name, data: new Uint8Array(b) }));
      }}
    >
      {settingBar && (
        <div className="action-set-row">
          <select className="prop-select" aria-label="Auto action set" value={set?.id} onChange={(e) => selectSet(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="Create new set"
            aria-label="Create new set"
            onClick={async () => {
              const name = await promptDialog('Create new set', 'Set');
              if (name) createActionSet(name);
            }}
          >
            <Icon name="newFolder" size={15} />
          </button>
          <button className="icon-btn" title="Add auto action set (import a file)" aria-label="Import set" onClick={() => void importActionSet()}>
            <Icon name="open" size={15} />
          </button>
        </div>
      )}
      {buttonMode ? (
        <div className="action-buttons" role="toolbar" aria-label="Auto action buttons">
          {set?.actions.map((a) => (
            <button key={a.id} className="btn action-button" disabled={Boolean(recording) || playing || !a.steps.some((st) => st.enabled)} onClick={() => void playAction(a.id, null)}>
              {a.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="action-list" role="tree" aria-label="Auto actions">
          {set?.actions.map((a, i) => <ActionRow key={a.id} a={a} index={i} steps={a.steps.length} />)}
          {set && set.actions.length === 0 && <div className="prop-note">No auto actions yet: add one and record.</div>}
        </div>
      )}
      {commandBar && !buttonMode && (
        <div className="action-bar">
          <button className={`icon-btn ${recording ? 'on' : ''}`} title={recording ? 'Stop recording auto action' : 'Start recording auto action'} aria-label={recording ? 'Stop recording auto action' : 'Start recording auto action'} aria-pressed={Boolean(recording)} disabled={playing} onClick={toggleRecording}>
            <span className={recording ? 'stop-square' : 'rec-dot'} />
          </button>
          <button className="icon-btn" title="Play auto action" aria-label="Play auto action" disabled={!selected || Boolean(recording) || playing} onClick={() => void playAction()}>
            <Icon name="play" size={15} />
          </button>
          <button className="icon-btn" title="Add auto action" aria-label="Add auto action" disabled={Boolean(recording)} onClick={() => void addNamed()}>
            <Icon name="new" size={15} />
          </button>
          <button className="icon-btn" title="Delete auto action" aria-label="Delete auto action" disabled={!selected || Boolean(recording)} onClick={() => void deleteAsked()}>
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
