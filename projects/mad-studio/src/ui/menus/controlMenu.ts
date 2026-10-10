import { describeTarget, fromNorm, toNorm, type TargetRange } from '../../model/automationTargets';
import { linkOf } from '../../model/controllerLinks';
import { automationChannelFor, createAutomationClip } from '../../store/automationActions';
import { endCoalesce, gestureKey } from '../../store/actions';
import { useStore } from '../../store/store';
import { openControllerLink, promptDialog, toast, type MenuItem } from '../overlays';
import { openChannelEditor } from '../workspace/windows';

export interface ControlSpec extends TargetRange {
  label: string;
  value: number;
  defaultValue: number;
  onChange: (value: number, gesture: string) => void;
  /** Automation target key; enables the automation entries. */
  target?: string;
  format?: (value: number) => string;
}

/** Normalized value on the "Copy value" clipboard. */
let copied: number | null = null;

function parseTyped(text: string, spec: ControlSpec): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  let v = Number(m[0].replace(',', '.'));
  if (/%/.test(text) && spec.max - spec.min <= 2.0001) v /= 100;
  else if (/k\s*hz/i.test(text)) v *= 1000;
  else if (/\bms\b/i.test(text) && spec.max <= 30) v /= 1000;
  if (!Number.isFinite(v)) return null;
  v = Math.min(spec.max, Math.max(spec.min, v));
  return spec.integer ? Math.round(v) : v;
}

/** FL Studio style control menu: Reset · Automation (clip, controller link) · Value. */
export function controlMenu(spec: ControlSpec): MenuItem[] {
  const project = useStore.getState().project;
  const target = spec.target && describeTarget(project, spec.target) ? spec.target : undefined;
  const existing = target ? automationChannelFor(project, target) : null;
  const link = target ? linkOf(project, target) : undefined;
  const set = (v: number) => {
    spec.onChange(v, gestureKey('menu'));
    endCoalesce();
  };
  return [
    { label: spec.label, header: true },
    { label: 'Reset', onClick: () => set(spec.defaultValue) },
    { label: 'Automation', header: true },
    {
      label: 'Create automation clip',
      disabled: !target,
      onClick: () => {
        if (target && createAutomationClip(target)) toast('Automation clip created – edit it in the playlist.');
      },
    },
    { label: 'Edit automation clip…', disabled: !existing, onClick: () => existing && openChannelEditor(existing) },
    { label: 'Link to controller…', shortcut: link ? `CC ${link.cc}` : undefined, disabled: !target, onClick: () => target && openControllerLink(target) },
    { label: 'Value', header: true },
    { label: 'Copy value', onClick: () => void (copied = toNorm(spec, spec.value)) },
    { label: 'Paste value', disabled: copied === null, onClick: () => copied !== null && set(fromNorm(spec, copied)) },
    {
      label: 'Type in value…',
      onClick: async () => {
        const shown = spec.format ? spec.format(spec.value) : String(spec.value);
        const text = await promptDialog(`${spec.label}`, shown);
        if (text === null) return;
        const v = parseTyped(text, spec);
        if (v === null) toast('Please type a number.', 'error');
        else set(v);
      },
    },
  ];
}
