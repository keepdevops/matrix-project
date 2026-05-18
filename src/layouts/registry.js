import DefaultLayout from './DefaultLayout';
import SidebarLayout from './SidebarLayout';
import MinimalLayout from './MinimalLayout';

export const LAYOUTS = {
  default: { label: 'Default', component: DefaultLayout },
  sidebar: { label: 'Sidebar', component: SidebarLayout },
  minimal: { label: 'Minimal', component: MinimalLayout },
};

export const THEMES = {
  dark:  { label: '☾ Dark' },
  light: { label: '☀ Light' },
  // terminal: { label: '⌨ Terminal', cssFile: '../themes/terminal.css' },
};
