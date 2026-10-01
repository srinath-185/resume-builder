import { Briefcase, FileUser, LayoutDashboard, Plug, UserCog } from 'lucide-react';
import JobSourcesPage from '@/modules/Jobs/JobSourcesPage';
import JobsPage from '@/modules/Jobs/JobsPage';
import ProfilePage from '@/modules/Profile/ProfilePage';
import ResumesPage from '@/modules/Resumes/ResumesPage';
import Dashboard from '@/screens/Dashboard';
import ResumeReviewPage from '@/screens/ResumeReview/ResumeReviewPage';

/**
 * Single source of truth for authenticated pages. `nav` entries appear in the
 * sidebar, grouped by section. Feature branches append here.
 */
export const APP_ROUTES = [
  { path: '/', element: <Dashboard />, nav: { label: 'Dashboard', icon: LayoutDashboard, section: 'main' } },
  { path: '/resumes', element: <ResumesPage />, nav: { label: 'Resumes', icon: FileUser, section: 'main' } },
  { path: '/resumes/:id', element: <ResumeReviewPage /> },
  { path: '/profile', element: <ProfilePage />, nav: { label: 'Search profile', icon: UserCog, section: 'main' } },
  { path: '/jobs', element: <JobsPage />, nav: { label: 'Jobs', icon: Briefcase, section: 'search' } },
  { path: '/settings/job-sources', element: <JobSourcesPage />, nav: { label: 'Job sources', icon: Plug, section: 'settings' } },
];

export const NAV_SECTIONS = [
  { id: 'main', label: null },
  { id: 'search', label: 'Job search' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'settings', label: 'Settings' },
];
