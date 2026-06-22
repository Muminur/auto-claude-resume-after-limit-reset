/**
 * Tests for plugin-version resolution in the daemon/hook launcher.
 *
 * Regression: the plugin cache can hold several extracted versions side by side
 * (e.g. 1.16.3 and 1.19.0). The resolver did a depth-first search and returned
 * the FIRST auto-resume-daemon.js found; since directory listings are
 * alphabetical, the oldest version sorted first and permanently shadowed every
 * newer build — so installed updates never actually ran.
 */

const { sortEntriesPreferLatest } = require('../scripts/ensure-daemon-running');

const names = (entries) => entries.map((e) => e.name);
const mk = (arr) => arr.map((name) => ({ name }));

describe('sortEntriesPreferLatest', () => {
  test('orders version directories highest-first', () => {
    const sorted = sortEntriesPreferLatest(mk(['1.16.3', '1.19.0', '1.18.0']));
    expect(names(sorted)).toEqual(['1.19.0', '1.18.0', '1.16.3']);
  });

  test('compares numerically, not alphabetically (1.20.0 > 1.9.0 > 1.19.0 order)', () => {
    // Alphabetically "1.20.0" < "1.9.0" and "1.19.0" < "1.9.0"; numerically the
    // opposite. This is the exact failure that pinned the daemon to an old build.
    const sorted = sortEntriesPreferLatest(mk(['1.9.0', '1.20.0', '1.19.0']));
    expect(names(sorted)).toEqual(['1.20.0', '1.19.0', '1.9.0']);
  });

  test('the original bug case: 1.16.3 must NOT sort before 1.19.0', () => {
    const sorted = sortEntriesPreferLatest(mk(['1.16.3', '1.19.0']));
    expect(names(sorted)[0]).toBe('1.19.0');
  });

  test('version directories sort before non-version names', () => {
    const sorted = sortEntriesPreferLatest(mk(['node_modules', '1.19.0', 'src', '1.20.0']));
    expect(names(sorted).slice(0, 2)).toEqual(['1.20.0', '1.19.0']);
    expect(names(sorted).slice(2).sort()).toEqual(['node_modules', 'src']);
  });

  test('sorts in place and returns the same array', () => {
    const entries = mk(['1.16.3', '1.19.0']);
    const result = sortEntriesPreferLatest(entries);
    expect(result).toBe(entries);
  });

  test('handles a single version and empty input', () => {
    expect(names(sortEntriesPreferLatest(mk(['1.19.0'])))).toEqual(['1.19.0']);
    expect(sortEntriesPreferLatest([])).toEqual([]);
  });
});
