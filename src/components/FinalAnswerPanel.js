import React from 'react';

function FinalAnswerPanel({ text }) {
  if (text === null || text === undefined) return null;
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return null;

  return (
    <section className="final-answer-panel" aria-label="Final answer">
      <header className="final-answer-panel__header">
        <span className="final-answer-panel__label">FINAL ANSWER</span>
      </header>
      <pre className="final-answer-panel__body">{text}</pre>
    </section>
  );
}

export default FinalAnswerPanel;
