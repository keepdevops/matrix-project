import DefaultLayout   from './DefaultLayout';
import SidebarLayout   from './SidebarLayout';
import MinimalLayout   from './MinimalLayout';
import TerminalLayout  from './TerminalLayout';
import DashboardLayout from './DashboardLayout';

export const LAYOUTS = {
  default:   { label: 'Default',   component: DefaultLayout },
  sidebar:   { label: 'Sidebar',   component: SidebarLayout },
  minimal:   { label: 'Minimal',   component: MinimalLayout },
  terminal:  { label: 'Terminal',  component: TerminalLayout },
  dashboard: { label: 'Dashboard', component: DashboardLayout },
};

export const THEMES = {
  dark:      { label: '☾ Dark' },
  light:     { label: '☀ Light' },
  overdrive: { label: '⚡ Overdrive' },
  synthwave: { label: '🌊 Synthwave' },
  cobalt:            { label: '💎 Cobalt' },
  greyscale:         { label: '◈ Greyscale' },
  'cvd-blue-orange':        { label: '⬡ CVD: Protanopia/Deuteranopia' },
  'cvd-teal-charcoal':     { label: '⬡ CVD: Tritanopia' },
  'cvd-amber':              { label: '⬡ CVD: Achromatopsia' },
  'cvd-light-blue-orange':  { label: '⬡ CVD Light: Protanopia/Deuteranopia' },
  'cvd-light-tritanopia':   { label: '⬡ CVD Light: Tritanopia' },
  'cvd-light-amber':        { label: '⬡ CVD Light: Achromatopsia' },
};
