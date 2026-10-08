import { CURVE_MODES } from '../../model/automation';
import { describeTarget, fromNorm, toNorm } from '../../model/automationTargets';
import type { AutomationData, Id } from '../../model/types';
import { deleteAutomationPoint, setPointMode, setPointValue } from '../../store/automationActions';
import { useStore } from '../../store/store';
import { promptDialog, toast, type MenuItem } from '../overlays';

let copiedValue: number | null = null;

/** FL Studio's point menu: "Point n/m", Delete, curve mode, copy/paste/type value. */
export function pointMenu(channelId: Id, data: AutomationData, index: number): MenuItem[] {
  const p = data.points[index];
  if (!p) return [];
  return [
    { label: `Point ${index + 1}/${data.points.length}`, header: true },
    { label: 'Delete', disabled: index === 0, onClick: () => deleteAutomationPoint(channelId, index) },
    { label: 'Mode', header: true },
    ...CURVE_MODES.map((m) => ({
      label: m.label,
      radio: true,
      checked: p.mode === m.id,
      disabled: index === 0,
      onClick: () => setPointMode(channelId, index, m.id),
    })),
    { separator: true },
    { label: 'Copy value', onClick: () => void (copiedValue = p.value) },
    { label: 'Paste value', disabled: copiedValue === null, onClick: () => copiedValue !== null && setPointValue(channelId, index, copiedValue) },
    {
      label: 'Type in value…',
      onClick: async () => {
        const project = useStore.getState().project;
        const info = data.target ? describeTarget(project, data.target) : null;
        const current = info ? info.format(fromNorm(info, p.value)) : `${Math.round(p.value * 100)}%`;
        const text = await promptDialog(info ? `Value (${info.label})` : 'Value (0–100 %)', current);
        if (text === null) return;
        const m = /-?\d+(?:[.,]\d+)?/.exec(text);
        if (!m) {
          toast('Please type a number.', 'error');
          return;
        }
        const n = Number(m[0].replace(',', '.'));
        const norm = info && !/%/.test(text) ? toNorm(info, /k\s*hz/i.test(text) ? n * 1000 : n) : n / 100;
        setPointValue(channelId, index, Math.min(1, Math.max(0, norm)));
      },
    },
  ];
}
