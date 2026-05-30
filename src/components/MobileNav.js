import React from 'react';

const TABS = [
  { id: 'prompt', icon: '✏', label: 'Prompt' },
  { id: 'chat',   icon: '💬', label: 'Chat'   },
  { id: 'agents', icon: '⬡',  label: 'Agents' },
];

export default function MobileNav({ activePanel, onSetPanel }) {
  return (
    <nav className="mobile-nav" aria-label="Panel navigation">
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={`mobile-nav__tab${activePanel === tab.id ? ' mobile-nav__tab--active' : ''}`}
          onClick={() => onSetPanel(tab.id)}
          aria-pressed={activePanel === tab.id}
          aria-label={`Show ${tab.label} panel`}
        >
          <span className="mobile-nav__tab-icon" aria-hidden="true">{tab.icon}</span>
          <span className="mobile-nav__tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
