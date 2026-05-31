import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BrewCodeResultsPanel from './BrewCodeResultsPanel';

jest.mock('../components/CodeOutputPanel', () => function MockCodeOutputPanel({
  sourceText, loading, headerExtra,
}) {
  return (
    <div data-testid="code-output-panel" data-loading={loading ? '1' : '0'}>
      {headerExtra}
      <pre>{sourceText}</pre>
    </div>
  );
});

const PYTHON = '```python\ndef hi():\n  return 1\n```';
const JS = '```javascript\nfunction hi() { return 1; }\n```';

describe('BrewCodeResultsPanel', () => {
  it('shows agent picker when multiple agents have fenced code', () => {
    render(
      <BrewCodeResultsPanel
        activeAgents={[{ name: 'programmer' }, { name: 'frontend' }]}
        responses={{ programmer: PYTHON, frontend: JS }}
        loading={false}
      />,
    );
    expect(screen.getByRole('tab', { name: 'PROGRAMMER' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'FRONTEND' })).toBeInTheDocument();
  });

  it('switches displayed code when another agent tab is selected', () => {
    render(
      <BrewCodeResultsPanel
        activeAgents={[{ name: 'programmer' }, { name: 'frontend' }]}
        responses={{ programmer: PYTHON, frontend: JS }}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'FRONTEND' }));
    expect(screen.getByRole('tab', { name: 'FRONTEND' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('code-output-panel')).toHaveTextContent('function hi');
  });

  it('hides picker for single code source', () => {
    render(
      <BrewCodeResultsPanel
        activeAgents={[{ name: 'programmer' }]}
        responses={{ programmer: PYTHON }}
        loading={false}
      />,
    );
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
