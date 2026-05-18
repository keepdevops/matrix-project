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
  dark:  { label: '☾ Dark' },
  light: { label: '☀ Light' },
  // terminal: { label: '⌨ Terminal', cssFile: '../themes/terminal.css' },
};
