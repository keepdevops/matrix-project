const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Brewlatte launch (Brew button)', () => {
  const brew = read('layouts/BrewlateLayout.js') + [
    'layouts/useBrewConfig.js', 'layouts/BrewConfigPanel.js', 'layouts/BrewConfigAgentsSection.js',
    'layouts/BrewRightPanel.js',
    'layouts/BrewPreviewPanel.js', 'layouts/BrewOverlays.js', 'layouts/BrewHistoryDropdown.js',
    'layouts/BrewSessionTab.js', 'layouts/BrewAgentsTab.js', 'layouts/BrewBroadcastTab.js',
    'layouts/BrewRagTab.js',
  ].map(f => read(f)).join('\n');
  const classic = read('components/ServerLayoutPreview.js');

  it('wires useDeploy and passes layout + risk to deploy()', () => {
    expect(brew).toMatch(/useDeploy\(/);
    expect(brew).toMatch(/brew-launch-btn/);
    expect(brew).toMatch(/deploy\(\{ roles, selected, roleModels, models, engine, riskEstimate, layout: serverLayout \}\)/);
    expect(brew).toMatch(/canDeploy\s*= selected\.size > 0/);
    expect(brew).toMatch(/status === 'deploying' \? 'Brewing…' : 'Brew'/);
    expect(brew).toMatch(/disabled=\{!canDeploy \|\| status === 'deploying'\}/);
  });

  it('transitions to Session panel after onDeployed', () => {
    expect(brew).toMatch(/setDeployed\(true\)/);
    expect(brew).toMatch(/deployed \? 'Session' : 'Live Preview'/);
  });

  it('classic equivalent uses LAUNCH SWARM via ServerLayoutPreview', () => {
    expect(classic).toMatch(/LAUNCH SWARM/);
    expect(classic).toMatch(/onDeploy/);
    expect(classic).toMatch(/status === 'deploying' \? 'LAUNCHING/);
  });
});
