import React from 'react';
import '../styles/Skeleton.css';

export function Skeleton({ width = '100%', height = '1em', radius = 'var(--radius-sm)', style = {} }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonAgentCard() {
  return (
    <div className="skeleton-agent-card">
      <div className="skeleton-agent-header">
        <Skeleton width="40%" height="0.85em" />
        <Skeleton width="5em" height="0.75em" />
      </div>
      <Skeleton height="0.7em" style={{ marginBottom: 6 }} />
      <Skeleton width="80%" height="0.7em" style={{ marginBottom: 6 }} />
      <Skeleton width="60%" height="0.7em" />
    </div>
  );
}

export default Skeleton;
