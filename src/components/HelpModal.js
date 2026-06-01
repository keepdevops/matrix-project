import React from 'react';
import Button from './Button';
import HelpModalContent from './HelpModalContent';

function HelpModal({ onClose, agents = [] }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span>Swarm Matrix — help</span>
          <Button variant="ghost" size="xs" className="help-close" onClick={onClose}>✕</Button>
        </div>
        <HelpModalContent agents={agents} />
      </div>
    </div>
  );
}

export default HelpModal;
