import React from 'react';

export default function DashboardStatTile({ label, value, sub, accent }) {
  return (
    <div className={`dl-stat-tile${accent ? ' dl-stat-tile--accent' : ''}`}>
      <div className="dl-stat-value">{value}</div>
      <div className="dl-stat-label">{label}</div>
      {sub && <div className="dl-stat-sub">{sub}</div>}
    </div>
  );
}
