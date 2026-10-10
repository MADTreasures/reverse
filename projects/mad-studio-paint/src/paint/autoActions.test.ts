import { describe, expect, it } from 'vitest';
import {
  addAction,
  addStep,
  defaultActionSets,
  deleteAction,
  duplicateAction,
  duplicateSet,
  duplicateStep,
  exportSetFile,
  importSetFile,
  moveAction,
  moveActionToSet,
  moveStep,
  newSet,
  newStep,
  renameAction,
  sanitizeActionSets,
  stepDetails,
  stepsToRun,
  updateStep,
} from './autoActions';

describe('auto actions', () => {
  it('records steps into an action and plays the enabled ones from a step on', () => {
    let sets = defaultActionSets();
    const set = sets[0].id;
    const { sets: s1, id } = addAction(sets, set, '  Mine  ');
    sets = s1;
    expect(sets[0].actions.at(-1)!.name).toBe('Mine');
    sets = addStep(sets, set, id, newStep('Select all', { kind: 'command', id: 'selectAll' }));
    sets = addStep(sets, set, id, newStep('Gaussian blur', { kind: 'filter', filter: 'gaussianBlur', values: { strength: 10 } }));
    sets = addStep(sets, set, id, newStep('Deselect', { kind: 'command', id: 'deselect' }));
    const action = sets[0].actions.find((a) => a.id === id)!;
    expect(stepsToRun(action).map((s) => s.label)).toEqual(['Select all', 'Gaussian blur', 'Deselect']);
    // Run switch off: skipped; started from the second step: the first is left out.
    sets = updateStep(sets, set, id, action.steps[1].id, { enabled: false });
    const after = sets[0].actions.find((a) => a.id === id)!;
    expect(stepsToRun(after).map((s) => s.label)).toEqual(['Select all', 'Deselect']);
    expect(stepsToRun(after, after.steps[1].id).map((s) => s.label)).toEqual(['Deselect']);
  });

  it('renames, duplicates, moves and deletes actions and sets', () => {
    let sets = defaultActionSets();
    const set = sets[0].id;
    const first = sets[0].actions[0];
    sets = renameAction(sets, set, first.id, 'Clipped layer');
    expect(sets[0].actions[0].name).toBe('Clipped layer');
    const dup = duplicateAction(sets, set, first.id);
    sets = dup.sets;
    expect(sets[0].actions[1]).toMatchObject({ id: dup.id, name: 'Clipped layer copy' });
    expect(sets[0].actions[1].steps.map((s) => s.label)).toEqual(first.steps.map((s) => s.label));
    expect(sets[0].actions[1].steps[0].id).not.toBe(first.steps[0].id);
    sets = moveAction(sets, set, dup.id!, 0);
    expect(sets[0].actions[0].id).toBe(dup.id);
    sets = deleteAction(sets, set, dup.id!);
    expect(sets[0].actions.some((a) => a.id === dup.id)).toBe(false);
    const made = newSet(sets, 'Comics');
    // A new set starts with one empty auto action.
    expect(made.sets.at(-1)).toMatchObject({ id: made.id, name: 'Comics', actions: [{ name: 'Auto action', steps: [] }] });
    const copy = duplicateSet(sets, set);
    expect(copy.sets.at(-1)!.actions).toHaveLength(sets[0].actions.length);
  });

  it('describes recorded settings and reads saved sets safely', () => {
    expect(stepDetails({ kind: 'grow', px: -20, rounded: true })).toEqual(['Shrinking width : 20 px', 'Shrinking type : Rounded corner']);
    expect(stepDetails({ kind: 'filter', filter: 'mosaic', values: { size: 8, square: true } })).toEqual(['Tile size : 8', 'square : Yes']);
    const sets = sanitizeActionSets([
      { id: 'set-a', name: 'A', actions: [{ id: 'act-a', name: '', steps: [{ id: 'x', label: 'Fill', op: { kind: 'command', id: 'fill' } }, { op: { kind: 'eval', code: '…' } }, { op: { kind: 'grow', px: 99999 } }] }] },
      'junk',
      { id: 'set-a', name: 'Same id', actions: 'none' },
    ]);
    expect(sets).toHaveLength(2);
    expect(sets[0].actions[0].name).toBe('Auto action');
    expect(sets[0].actions[0].steps.map((s) => s.op)).toEqual([
      { kind: 'command', id: 'fill' },
      { kind: 'grow', px: 1000, rounded: true },
    ]);
    // A repeated id gets a new one.
    expect(sets[1].id).not.toBe('set-a');
    expect(sanitizeActionSets('junk')).toEqual([]);
  });

  it('duplicates and moves commands, moves and copies actions to other sets', () => {
    let sets = defaultActionSets();
    const set = sets[0].id;
    const [a, b] = sets[0].actions;
    const dup = duplicateStep(sets, set, a.id, a.steps[0].id);
    sets = dup.sets;
    expect(sets[0].actions[0].steps.map((s) => s.label)).toEqual(['New raster layer', 'New raster layer', 'Clip to layer below']);
    // Dropped before the last command of the same action, then into the other action first.
    sets = moveStep(sets, set, a.id, a.steps[0].id, a.id, 2);
    expect(sets[0].actions[0].steps.map((s) => s.id)).toEqual([dup.id, a.steps[0].id, a.steps[1].id]);
    sets = moveStep(sets, set, a.id, a.steps[1].id, b.id, 0);
    expect(sets[0].actions[0].steps).toHaveLength(2);
    expect(sets[0].actions[1].steps.map((s) => s.label)).toEqual(['Clip to layer below', 'New raster layer', 'Set as draft layer']);
    const other = newSet(sets, 'Other');
    sets = other.sets;
    const copied = moveActionToSet(sets, set, a.id, other.id, true);
    expect(copied[0].actions.some((x) => x.id === a.id)).toBe(true);
    expect(copied[1].actions.at(-1)!.name).toBe(a.name);
    expect(copied[1].actions.at(-1)!.id).not.toBe(a.id);
    const moved = moveActionToSet(sets, set, a.id, other.id, false);
    expect(moved[0].actions.some((x) => x.id === a.id)).toBe(false);
    expect(moved[1].actions.at(-1)!.id).toBe(a.id);
  });

  it('exports a set to a file and imports it with new ids', () => {
    const sets = defaultActionSets();
    const text = exportSetFile(sets[0]);
    const read = importSetFile(sets, text)!;
    expect(read.sets).toHaveLength(2);
    const set = read.sets[1];
    expect(set.id).toBe(read.id);
    expect(set.name).toBe('Default');
    expect(set.actions.map((a) => a.name)).toEqual(sets[0].actions.map((a) => a.name));
    expect(set.actions[0].id).not.toBe(sets[0].actions[0].id);
    expect(importSetFile(sets, '{"set":{}}')).toBeNull();
    expect(importSetFile(sets, 'not json')).toBeNull();
  });
});
