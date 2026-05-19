import React from 'react';
import { EditorProvider } from './EditorContext';
import EditorShell from './EditorShell';

export default function EditorApp() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}
