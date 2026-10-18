import { describe, expect, it } from 'vitest';
import type { Segment } from '../types/segment';
import {
  countSegmentsWithLabel,
  getUniqueSpeakerLabels,
  mergeSpeakerLabels,
  renameSpeakerLabel,
} from './speaker-labels';

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    startTime: 0,
    endTime: 1,
    originalText: 'hello',
    consensusStatus: 'UNDECIDED',
    ...overrides,
  };
}

describe('getUniqueSpeakerLabels', () => {
  it('returns empty array for segments without speaker labels', () => {
    const segments = [makeSegment(), makeSegment({ segmentId: 'seg-2' })];
    expect(getUniqueSpeakerLabels(segments)).toEqual([]);
  });

  it('returns unique labels in order of first appearance', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_1' }),
      makeSegment({ segmentId: 'seg-2', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-3', speakerLabel: 'spk_1' }),
      makeSegment({ segmentId: 'seg-4', speakerLabel: 'spk_2' }),
    ];
    expect(getUniqueSpeakerLabels(segments)).toEqual([
      'spk_1',
      'spk_0',
      'spk_2',
    ]);
  });

  it('returns empty array for empty segments', () => {
    expect(getUniqueSpeakerLabels([])).toEqual([]);
  });

  it('skips segments without speakerLabel', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-2' }),
      makeSegment({ segmentId: 'seg-3', speakerLabel: 'spk_1' }),
    ];
    expect(getUniqueSpeakerLabels(segments)).toEqual(['spk_0', 'spk_1']);
  });
});

describe('renameSpeakerLabel', () => {
  it('renames all segments with the old label to the new label', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-2', speakerLabel: 'spk_1' }),
      makeSegment({ segmentId: 'seg-3', speakerLabel: 'spk_0' }),
    ];

    const result = renameSpeakerLabel(segments, 'spk_0', 'Speaker A');
    expect(result[0].speakerLabel).toBe('Speaker A');
    expect(result[1].speakerLabel).toBe('spk_1');
    expect(result[2].speakerLabel).toBe('Speaker A');
  });

  it('does not mutate the original array', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
    ];
    const result = renameSpeakerLabel(segments, 'spk_0', 'new_label');
    expect(segments[0].speakerLabel).toBe('spk_0');
    expect(result[0].speakerLabel).toBe('new_label');
  });

  it('returns unchanged segments when old label does not exist', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
    ];
    const result = renameSpeakerLabel(segments, 'nonexistent', 'new_label');
    expect(result[0].speakerLabel).toBe('spk_0');
  });

  it('handles segments without speakerLabel', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-2' }),
    ];
    const result = renameSpeakerLabel(segments, 'spk_0', 'new_label');
    expect(result[0].speakerLabel).toBe('new_label');
    expect(result[1].speakerLabel).toBeUndefined();
  });

  it('handles empty segments array', () => {
    expect(renameSpeakerLabel([], 'spk_0', 'new_label')).toEqual([]);
  });
});

describe('countSegmentsWithLabel', () => {
  it('counts segments with the specified label', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-2', speakerLabel: 'spk_1' }),
      makeSegment({ segmentId: 'seg-3', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-4', speakerLabel: 'spk_0' }),
    ];
    expect(countSegmentsWithLabel(segments, 'spk_0')).toBe(3);
    expect(countSegmentsWithLabel(segments, 'spk_1')).toBe(1);
  });

  it('returns 0 when label does not exist', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
    ];
    expect(countSegmentsWithLabel(segments, 'nonexistent')).toBe(0);
  });

  it('returns 0 for empty segments', () => {
    expect(countSegmentsWithLabel([], 'spk_0')).toBe(0);
  });

  it('does not count segments without speakerLabel', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-2' }),
    ];
    expect(countSegmentsWithLabel(segments, 'spk_0')).toBe(1);
  });
});

describe('mergeSpeakerLabels', () => {
  it('returns the union of segment-derived labels and master labels', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
      makeSegment({ segmentId: 'seg-2', speakerLabel: 'spk_1' }),
    ];
    expect(mergeSpeakerLabels(segments, ['spk_2', 'spk_3'])).toEqual([
      'spk_0',
      'spk_1',
      'spk_2',
      'spk_3',
    ]);
  });

  it('keeps segment-derived labels first and appends only new master labels', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
    ];
    // spk_0 is already present via segments; only spk_9 is new.
    expect(mergeSpeakerLabels(segments, ['spk_0', 'spk_9'])).toEqual([
      'spk_0',
      'spk_9',
    ]);
  });

  it('removes duplicates within master labels', () => {
    expect(mergeSpeakerLabels([], ['spk_0', 'spk_0', 'spk_1'])).toEqual([
      'spk_0',
      'spk_1',
    ]);
  });

  it('returns segment labels when master list is undefined', () => {
    const segments = [
      makeSegment({ segmentId: 'seg-1', speakerLabel: 'spk_0' }),
    ];
    expect(mergeSpeakerLabels(segments)).toEqual(['spk_0']);
  });

  it('includes a master label even when no segments use it', () => {
    expect(mergeSpeakerLabels([], ['新しい話者'])).toEqual(['新しい話者']);
  });

  it('ignores empty-string master labels', () => {
    expect(mergeSpeakerLabels([], ['', 'spk_0'])).toEqual(['spk_0']);
  });

  it('returns empty array for no segments and no master list', () => {
    expect(mergeSpeakerLabels([])).toEqual([]);
  });
});
