import React from 'react';
import Button from './Button';
import { HelpModalStaticSections } from './HelpModalSections';

function HelpModal({ onClose, agents = [] }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span>Swarm Matrix — help</span>
          <Button variant="ghost" size="xs" className="help-close" onClick={onClose}>✕</Button>
        </div>
        <div className="help-body">
          <HelpModalStaticSections agents={agents} />
        </div>
      </div>
    </div>
  );
}

export default HelpModal;
