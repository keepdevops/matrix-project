import { applyModeManifest, getModeManifestEntry } from './modeManifest';

describe('modeManifest', () => {
  it('keeps C++ production modes in UI list', () => {
    const api = [
      { name: 'flat', description: 'a', active: true },
      { name: 'pipeline', description: 'b', active: false },
    ];
    const out = applyModeManifest(api);
    expect(out.map(m => m.name)).toEqual(['flat', 'pipeline']);
    expect(out[0].backend).toBe('cpp');
  });

  it('filters python-only modes from UI', () => {
    const api = [
      { name: 'flat', active: true },
      { name: 'map_reduce', active: false },
    ];
    expect(applyModeManifest(api).map(m => m.name)).toEqual(['flat']);
  });

  it('getModeManifestEntry returns note for python plugins', () => {
    const entry = getModeManifestEntry('map_reduce');
    expect(entry.backend).toBe('python');
    expect(entry.ui).toBe(false);
  });
});
