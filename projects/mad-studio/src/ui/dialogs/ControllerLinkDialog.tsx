import { useEffect, useState } from 'react';
import { describeTarget } from '../../model/automationTargets';
import { CONTROLLER_MAPPINGS, canBeOmni, describeLink, linkOf } from '../../model/controllerLinks';
import type { ControllerMapping } from '../../model/types';
import { removeControllerLink, setControllerLink } from '../../store/actions';
import { useStore } from '../../store/store';
import { enableMidi, listenForControllers, useMidi } from '../midiInput';
import { closeDialog, toast } from '../overlays';

/**
 * FL Studio's Remote control settings (right-click a control › Link to controller…): move a knob,
 * fader or wheel on the MIDI controller (Auto detect) or pick the channel and controller number, then
 * Accept. The link is saved with the project.
 */
export function ControllerLinkDialog({ target }: { target: string }) {
  const project = useStore((s) => s.project);
  const info = describeTarget(project, target);
  const existing = linkOf(project, target);
  const midi = useMidi();
  const [channel, setChannel] = useState(existing?.channel ?? 0);
  const [cc, setCc] = useState<number | null>(existing?.cc ?? null);
  const [autoDetect, setAutoDetect] = useState(true);
  const [omni, setOmni] = useState(existing?.omni ?? false);
  const [mapping, setMapping] = useState<ControllerMapping>(existing?.mapping ?? 'default');
  const [pickup, setPickup] = useState(existing?.pickup ?? false);
  const [removeConflicts, setRemoveConflicts] = useState(true);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    if (!autoDetect) return undefined;
    return listenForControllers((ch, number) => {
      setChannel(ch);
      setCc(number);
      setDetected(true);
    });
  }, [autoDetect]);

  if (!info) return null;
  const omniPossible = canBeOmni(target);
  const conflicts = cc === null ? [] : (project.controllerLinks ?? []).filter((l) => l.target !== target && l.channel === channel && l.cc === cc);
  const conflictNames = conflicts.map((l) => describeTarget(project, l.target)?.label ?? l.target);

  const accept = () => {
    if (cc === null) return;
    const link = { id: existing?.id, target, channel, cc, omni: omni && omniPossible, mapping, pickup };
    setControllerLink(link, { removeConflicts });
    toast(`${describeLink(link)} now controls ${info.label}.`);
    closeDialog();
  };
  const reset = () => {
    setChannel(0);
    setCc(null);
    setAutoDetect(true);
    setOmni(false);
    setMapping('default');
    setPickup(false);
    setRemoveConflicts(true);
    setDetected(false);
  };

  const off = !midi.enabled && !detected;
  let status: string;
  if (detected && cc !== null) status = `Detected controller ${cc} on channel ${channel + 1}.`;
  else if (off) status = 'MIDI input is off – turn it on, or type the controller number.';
  else if (autoDetect) status = midi.inputs > 0 ? 'Move a knob, fader or wheel on your MIDI controller…' : 'No MIDI input found – connect a controller, or type the controller number.';
  else status = 'Type the channel and controller number.';

  return (
    <form
      className="modal small controller-link"
      role="dialog"
      aria-label="Remote control settings"
      onSubmit={(e) => {
        e.preventDefault();
        accept();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closeDialog();
      }}
    >
      <h2>Remote control settings</h2>
      <p className="controller-link-target">
        Link to <span className="accent">{info.label}</span>
      </p>
      <p className={`controller-link-status${autoDetect && !detected && !off ? ' waiting' : ''}`} role="status">
        {status}
        {off && (
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void enableMidi().catch((err: unknown) => toast(err instanceof Error ? err.message : 'MIDI is not available.', 'error'))
            }
          >
            Enable MIDI input
          </button>
        )}
      </p>
      <div className="settings-grid">
        <label htmlFor="cl-channel">Channel</label>
        <select id="cl-channel" value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>
        <label htmlFor="cl-cc">Controller</label>
        <input
          id="cl-cc"
          type="number"
          min={0}
          max={127}
          placeholder="move a control"
          value={cc ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? null : Math.round(Number(e.target.value));
            setCc(v === null || !Number.isFinite(v) ? null : Math.min(127, Math.max(0, v)));
            setDetected(false);
          }}
        />
        <label htmlFor="cl-mapping">Mapping formula</label>
        <select id="cl-mapping" value={mapping} onChange={(e) => setMapping(e.target.value as ControllerMapping)}>
          {CONTROLLER_MAPPINGS.map((m) => (
            <option key={m.id} value={m.id} title={m.hint}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="span2 checks">
          <label data-hint="Fill in channel and controller from the next control you move on the MIDI device">
            <input type="checkbox" checked={autoDetect} onChange={(e) => setAutoDetect(e.target.checked)} />
            Auto detect
          </label>
          <label data-hint={omniPossible ? 'Control this parameter of whichever channel is selected' : 'Omni is for channel parameters'}>
            <input type="checkbox" checked={omni && omniPossible} disabled={!omniPossible} onChange={(e) => setOmni(e.target.checked)} />
            Omni
          </label>
          <label data-hint="The control only follows once the controller reaches its current value – no jumps">
            <input type="checkbox" checked={pickup} onChange={(e) => setPickup(e.target.checked)} />
            Pickup (takeover mode)
          </label>
          <label data-hint="Other links on this controller are removed">
            <input type="checkbox" checked={removeConflicts} onChange={(e) => setRemoveConflicts(e.target.checked)} />
            Remove conflicts
          </label>
        </div>
      </div>
      {conflictNames.length > 0 && (
        <p className="warn">
          This controller also moves {conflictNames.join(', ')}
          {removeConflicts ? ' – that link will be removed.' : '.'}
        </p>
      )}
      <div className="modal-actions">
        {existing && (
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              removeControllerLink(target);
              closeDialog();
            }}
          >
            Remove
          </button>
        )}
        <button type="button" className="btn" onClick={reset}>
          Reset
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => closeDialog()}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={cc === null}>
          Accept
        </button>
      </div>
    </form>
  );
}
