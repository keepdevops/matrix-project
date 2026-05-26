import React from 'react';

export default function Button({
  variant = 'outline-primary',
  size = 'md',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
