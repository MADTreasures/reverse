import type { SampleInfo } from './types';

/**
 * Catalogue of the built-in sounds. The audio itself is synthesised at start-up
 * (audio/factorySamples.ts), so the app ships without any third-party samples.
 */
export interface FactorySampleDef {
  key: string;
  name: string;
  category: 'Kicks' | 'Snares & Claps' | 'Hats & Cymbals' | 'Percussion' | 'Bass' | 'FX';
  /** Pitch at which the sound was generated. */
  rootKey: number;
  /** Suggested choke group (open/closed hats). */
  chokeGroup?: number;
}

export const FACTORY_SAMPLES: FactorySampleDef[] = [
  { key: 'kick_punch', name: 'Kick Punch', category: 'Kicks', rootKey: 60 },
  { key: 'kick_deep', name: 'Kick Deep', category: 'Kicks', rootKey: 60 },
  { key: 'kick_808', name: 'Kick 808', category: 'Kicks', rootKey: 60 },
  { key: 'snare_tight', name: 'Snare Tight', category: 'Snares & Claps', rootKey: 60 },
  { key: 'snare_fat', name: 'Snare Fat', category: 'Snares & Claps', rootKey: 60 },
  { key: 'clap', name: 'Clap', category: 'Snares & Claps', rootKey: 60 },
  { key: 'snap', name: 'Snap', category: 'Snares & Claps', rootKey: 60 },
  { key: 'rim', name: 'Rim', category: 'Snares & Claps', rootKey: 60 },
  { key: 'hat_closed', name: 'Hat Closed', category: 'Hats & Cymbals', rootKey: 60, chokeGroup: 1 },
  { key: 'hat_open', name: 'Hat Open', category: 'Hats & Cymbals', rootKey: 60, chokeGroup: 1 },
  { key: 'ride', name: 'Ride', category: 'Hats & Cymbals', rootKey: 60 },
  { key: 'crash', name: 'Crash', category: 'Hats & Cymbals', rootKey: 60 },
  { key: 'tom_low', name: 'Tom Low', category: 'Percussion', rootKey: 60 },
  { key: 'tom_high', name: 'Tom High', category: 'Percussion', rootKey: 60 },
  { key: 'cowbell', name: 'Cowbell', category: 'Percussion', rootKey: 60 },
  { key: 'shaker', name: 'Shaker', category: 'Percussion', rootKey: 60 },
  { key: 'blip', name: 'Perc Blip', category: 'Percussion', rootKey: 60 },
  { key: 'bass_808', name: '808 Sub', category: 'Bass', rootKey: 36 },
  { key: 'fx_riser', name: 'Riser', category: 'FX', rootKey: 60 },
  { key: 'fx_impact', name: 'Impact', category: 'FX', rootKey: 60 },
];

export function factorySampleId(key: string): string {
  return `factory:${key}`;
}

export function findFactorySample(key: string): FactorySampleDef | undefined {
  return FACTORY_SAMPLES.find((s) => s.key === key);
}

export function factorySampleInfo(key: string): SampleInfo {
  const def = findFactorySample(key);
  return { id: factorySampleId(key), name: def?.name ?? key, source: 'factory', factoryKey: key };
}
