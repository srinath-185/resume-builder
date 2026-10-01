import { Bot, Briefcase, ClipboardCheck, Contact, FileText, FileUser, LayoutDashboard, Linkedin, Mail, Megaphone, Plug, Send, UserCog } from 'lucide-react';
import ApplicationsPage from '@/modules/Applications/ApplicationsPage';
import JobSourcesPage from '@/modules/Jobs/JobSourcesPage';
import JobsPage from '@/modules/Jobs/JobsPage';
import ComposePage from '@/modules/Outreach/ComposePage';
import ContactsPage from '@/modules/Outreach/ContactsPage';
import HiringPostsPage from '@/modules/Outreach/HiringPostsPage';
import OutreachPage from '@/modules/Outreach/OutreachPage';
import TemplatesPage from '@/modules/Outreach/TemplatesPage';
import ProfilePage from '@/modules/Profile/ProfilePage';
import ResumesPage from '@/modules/Resumes/ResumesPage';
import AiUsagePage from '@/modules/Settings/AiUsagePage';
import LinkedInSessionPage from '@/modules/Settings/LinkedInSessionPage';
import MailSettingsPage from '@/modules/Settings/MailSettingsPage';
import ApplicationReviewPage from '@/screens/ApplicationReview/ApplicationReviewPage';
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
  { path: '/applications', element: <ApplicationsPage />, nav: { label: 'Applications', icon: ClipboardCheck, section: 'search' } },
  { path: '/applications/:id', element: <ApplicationReviewPage /> },
  { path: '/hiring-posts', element: <HiringPostsPage />, nav: { label: 'Hiring posts', icon: Megaphone, section: 'outreach' } },
  { path: '/outreach', element: <OutreachPage />, nav: { label: 'Outbox', icon: Send, section: 'outreach' } },
  { path: '/outreach/new', element: <ComposePage /> },
  { path: '/contacts', element: <ContactsPage />, nav: { label: 'Contacts', icon: Contact, section: 'outreach' } },
  { path: '/settings/mail', element: <MailSettingsPage />, nav: { label: 'Mailbox', icon: Mail, section: 'settings' } },
  { path: '/settings/templates', element: <TemplatesPage />, nav: { label: 'Email templates', icon: FileText, section: 'settings' } },
  { path: '/settings/job-sources', element: <JobSourcesPage />, nav: { label: 'Job sources', icon: Plug, section: 'settings' } },
  { path: '/settings/linkedin', element: <LinkedInSessionPage />, nav: { label: 'LinkedIn session', icon: Linkedin, section: 'settings' } },
  { path: '/settings/ai', element: <AiUsagePage />, nav: { label: 'AI usage', icon: Bot, section: 'settings' } },
];

export const NAV_SECTIONS = [
  { id: 'main', label: null },
  { id: 'search', label: 'Job search' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'settings', label: 'Settings' },
];
