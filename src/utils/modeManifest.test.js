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

  it('includes Python orchestrate modes in UI list (MS-25-2/3 enabled)', () => {
    const api = [
      { name: 'flat', active: true },
      { name: 'map_reduce', active: false },
      { name: 'speculative', active: false },
      { name: 'critic_debate', active: false },
    ];
    const names = applyModeManifest(api).map(m => m.name);
    expect(names).toContain('map_reduce');
    expect(names).toContain('speculative');
    expect(names).toContain('critic_debate');
  });

  it('getModeManifestEntry returns python backend and ui:true for enabled orchestrate modes', () => {
    for (const mode of ['map_reduce', 'speculative', 'critic_debate']) {
      const entry = getModeManifestEntry(mode);
      expect(entry.backend).toBe('python');
      expect(entry.ui).toBe(true);
      expect(entry.enabled).toBe(true);
    }
  });
});
