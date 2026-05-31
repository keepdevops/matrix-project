import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BrewAgentGrid from './BrewAgentGrid';

jest.mock('./BrewAgentPopout', () => () => null);
jest.mock('../components/AgentMarkdown', () => function MockMarkdown({ text }) {
  return <div data-testid="markdown">{text}</div>;
});
jest.mock('../components/CodeOutputPanel', () => function MockCodeOutputPanel({
  sourceText, loading, sectionClassName, onSaveCode, showSave,
}) {
  return (
    <div className={`brew-code-output-section ${sectionClassName || ''}`.trim()}>
      {showSave && onSaveCode && (
        <button type="button" onClick={onSaveCode}>SAVE CODE</button>
      )}
      <pre data-testid="code-output-panel" data-loading={loading ? '1' : '0'}>
        {sourceText}
      </pre>
    </div>
  );
});
jest.mock('../components/Skeleton', () => ({
  SkeletonAgentCard: () => <div data-testid="skeleton" />,
}));

describe('BrewAgentGrid code generation UI', () => {
  const agents = [
    { name: 'programmer', model: '/m/coder.gguf', port: 8080 },
    { name: 'architect', model: '/m/arch.gguf', port: 8081 },
  ];

  it('renders programmer CODE OUTPUT from markdown fence', () => {
    render(
      <BrewAgentGrid
        activeAgents={agents}
        responses={{
          programmer: 'Here is the solution:\n```python\nprint("fib")\n```\n',
          architect: 'Design only prose.',
        }}
        loading={false}
        onSaveCode={jest.fn()}
      />,
    );
    const section = document.querySelector('.brew-code-output-section--grid');
    expect(section).not.toBeNull();
    expect(within(section).getByTestId('code-output-panel').textContent).toContain('print("fib")');
  });

  it('invokes onSaveCode when SAVE CODE clicked', () => {
    const onSaveCode = jest.fn();
    render(
      <BrewAgentGrid
        activeAgents={agents}
        responses={{ programmer: '```js\nconst x = 1;\n```' }}
        loading={false}
        onSaveCode={onSaveCode}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'SAVE CODE' }));
    expect(onSaveCode).toHaveBeenCalledTimes(1);
  });

  it('shows programmer panel while loading before first token', () => {
    render(
      <BrewAgentGrid
        activeAgents={agents}
        responses={{}}
        loading
        onSaveCode={jest.fn()}
      />,
    );
    const section = document.querySelector('.brew-code-output-section--grid');
    expect(section).not.toBeNull();
    expect(within(section).getByTestId('code-output-panel').getAttribute('data-loading')).toBe('1');
  });

  it('omits SAVE CODE when extracted code is too short', () => {
    render(
      <BrewAgentGrid
        activeAgents={agents}
        responses={{ programmer: '```py\nx\n```' }}
        loading={false}
        onSaveCode={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'SAVE CODE' })).toBeNull();
  });
});
