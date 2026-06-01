import { useState, useEffect } from 'react';

export function useBrewlateLayout({ online, activeAgents, loading, lastMeta }) {
  const [deployed, setDeployed]             = useState(false);
  const [rightTab, setRightTab]             = useState('session');
  const [showMonitor, setShowMonitor]       = useState(false);
  const [showAgentsPopout, setShowAgentsPopout] = useState(false);
  const [leftPopout, setLeftPopout]         = useState(null);

  useEffect(() => {
    if (loading) setRightTab('brewcast');
    else if (lastMeta) setRightTab('session');
  }, [loading, lastMeta]);

  useEffect(() => {
    if (online && activeAgents.length > 0) setDeployed(true);
    else if (!online) setDeployed(false);
  }, [online, activeAgents.length]);

  return {
    deployed, setDeployed,
    rightTab, setRightTab,
    showMonitor, setShowMonitor,
    showAgentsPopout, setShowAgentsPopout,
    leftPopout, setLeftPopout,
  };
}
