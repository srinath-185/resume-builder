import { LayoutDashboard } from 'lucide-react';
import Dashboard from '@/screens/Dashboard';

/**
 * Single source of truth for authenticated pages. `nav` entries appear in the
 * sidebar, grouped by section. Feature branches append here.
 */
export const APP_ROUTES = [{ path: '/', element: <Dashboard />, nav: { label: 'Dashboard', icon: LayoutDashboard, section: 'main' } }];

export const NAV_SECTIONS = [
  { id: 'main', label: null },
  { id: 'search', label: 'Job search' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'settings', label: 'Settings' },
];
