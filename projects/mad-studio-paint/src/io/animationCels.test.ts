import { describe, expect, it } from 'vitest';
import { celFileName, exposureSheetCsv, uniqueNames } from './animationCels';
import { encodeWav } from './wav';

describe('Export animation cels', () => {
  const o = { prefix: '', suffix: '', separator: '_' };
  it('names cel files like the reference', () => {
    expect(celFileName({ ...o, format: 'cel' }, 'A', '3', 2)).toBe('3');
    expect(celFileName({ ...o, format: 'number' }, 'A', '3', 2)).toBe('0002');
    expect(celFileName({ ...o, format: 'folderCel' }, 'A', '3', 2)).toBe('A_3');
    expect(celFileName({ ...o, format: 'folderNumber', prefix: 'walk', suffix: 'v1' }, 'A', '3', 12)).toBe('walk_A_0012_v1');
    // No separator: the parts are joined directly; unsafe characters go.
    expect(celFileName({ ...o, format: 'folderCel', separator: '' }, 'B/C', 'x:y', 1)).toBe('BCxy');
    expect(uniqueNames(['1', '2', '1', '1'])).toEqual(['1', '2', '1 (2)', '1 (3)']);
  });
});

describe('Exposure sheet', () => {
  it('writes parents, folder names and the cel of each frame', () => {
    const csv = exposureSheetCsv(
      [
        { parent: '', name: 'A', track: { cels: [{ frame: 1, cel: 'a1' }, { frame: 3, cel: 'a2' }] }, cels: new Map([['a1', '1'], ['a2', '2']]) },
        { parent: 'Scene, 1', name: 'B', track: { cels: [{ frame: 2, cel: null }] }, cels: new Map() },
      ],
      3,
    );
    expect(csv.split('\r\n')).toEqual([',,"Scene, 1"', 'Frame,A,B', '1,1,', '2,,×', '3,2,', '']);
  });
});

describe('WAV', () => {
  it('writes 16- and 24-bit PCM, interleaved', () => {
    const w = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 48000, 16);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4), ...w.subarray(8, 12))).toBe('RIFFWAVE');
    expect([v.getUint32(4, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([36 + 12, 2, 48000, 16, 12]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(52, true)]).toEqual([0, 16384, 32767, -32767]);
    const w24 = encodeWav([new Float32Array([1])], 44100, 24);
    expect([w24.length, w24[44], w24[45], w24[46]]).toEqual([47, 0xff, 0xff, 0x7f]);
  });
});
