import { EFFECT_SPECS, EFFECT_TYPES } from '../../model/effects';
import type { PluginDescription, PluginInstanceData } from '../../model/types';
import { usePlugins } from '../../plugins/pluginStore';
import { addEffect, addPluginChannel, addPluginEffect, replaceEffect, replaceEffectWithPlugin } from '../../store/actions';
import { openDialog, toast, type MenuItem } from '../overlays';
import { openChannelEditor, openEffectEditor } from '../workspace/windows';

export function pluginInstanceFrom(desc: PluginDescription): PluginInstanceData {
  return {
    uid: desc.uid,
    name: desc.name,
    vendor: desc.vendor,
    format: desc.format,
    fileOrIdentifier: desc.fileOrIdentifier,
    isInstrument: desc.isInstrument,
    state: null,
  };
}

/** Groups plugins by vendor (FL's plugin picker groups by category; vendors are more useful for VSTs). */
function groupedPlugins(list: PluginDescription[], onPick: (p: PluginDescription) => void): MenuItem[] {
  const byVendor = new Map<string, PluginDescription[]>();
  for (const p of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    const v = p.vendor || 'Other';
    byVendor.set(v, [...(byVendor.get(v) ?? []), p]);
  }
  const item = (p: PluginDescription): MenuItem => ({ label: `${p.name}${p.format === 'AudioUnit' ? ' (AU)' : p.format === 'VST3' ? ' (VST3)' : ` (${p.format})`}`, onClick: () => onPick(p) });
  if (list.length <= 14) return list.map(item);
  return [...byVendor.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([vendor, plugins]) => ({ label: vendor, submenu: plugins.map(item) }));
}

function pluginSection(instruments: boolean, onPick: (p: PluginDescription) => void): MenuItem[] {
  const st = usePlugins.getState();
  if (!st.nativeEngine) {
    return [{ label: 'Plugins (VST3/AU) need the desktop app', disabled: true }];
  }
  const list = st.plugins.filter((p) => p.isInstrument === instruments);
  return [
    ...(list.length ? groupedPlugins(list, onPick) : [{ label: 'No plugins found – scan in “Manage plugins”', disabled: true }]),
    { separator: true },
    { label: 'Manage plugins…', onClick: () => openDialog('plugins') },
  ];
}

/** Menu of an effect slot: built-in effects plus effect plugins (FL: slot menu › Select / Replace). */
export function effectSlotMenu(trackIndex: number, slotId: string | null): MenuItem[] {
  const pickBuiltIn = (type: (typeof EFFECT_TYPES)[number]) => {
    if (slotId) replaceEffect(trackIndex, slotId, type);
    else {
      const id = addEffect(trackIndex, type);
      if (id) openEffectEditor(trackIndex, id);
      else toast('All 10 effect slots are in use.', 'error');
    }
  };
  const pickPlugin = (p: PluginDescription) => {
    if (slotId) replaceEffectWithPlugin(trackIndex, slotId, pluginInstanceFrom(p));
    else {
      const id = addPluginEffect(trackIndex, pluginInstanceFrom(p));
      if (id) openEffectEditor(trackIndex, id);
      else toast('All 10 effect slots are in use.', 'error');
    }
  };
  return [
    { label: 'MAD Studio effects', header: true },
    ...EFFECT_TYPES.map((type) => ({ label: EFFECT_SPECS[type].name, onClick: () => pickBuiltIn(type) })),
    { label: 'Plugins', header: true },
    ...pluginSection(false, pickPlugin),
  ];
}

/** Plugin instruments for the channel rack's add menu. */
export function instrumentPluginItems(): MenuItem[] {
  return pluginSection(true, (p) => {
    const id = addPluginChannel(pluginInstanceFrom(p));
    openChannelEditor(id);
  });
}
