import { Bot, Briefcase, ClipboardCheck, Contact, FileText, FileUser, Gauge, LayoutDashboard, Linkedin, Mail, Megaphone, Plug, ScrollText, Send, UserCog, Users } from 'lucide-react';
import AdminUsagePage from '@/modules/Admin/AdminUsagePage';
import AuditLogPage from '@/modules/Admin/AuditLogPage';
import UsersPage from '@/modules/Admin/UsersPage';
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

const ADMINS = ['admin', 'superadmin'];

/**
 * Single source of truth for authenticated pages. `nav` entries appear in the
 * sidebar, grouped by section. `roles` limits who sees a page (display only:
 * the API checks the role on every admin request). Feature branches append here.
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
  { path: '/admin/users', element: <UsersPage />, roles: ADMINS, nav: { label: 'Users', icon: Users, section: 'admin' } },
  { path: '/admin/audit-log', element: <AuditLogPage />, roles: ADMINS, nav: { label: 'Audit log', icon: ScrollText, section: 'admin' } },
  { path: '/admin/ai-usage', element: <AdminUsagePage />, roles: ADMINS, nav: { label: 'AI usage (all)', icon: Gauge, section: 'admin' } },
];

export const NAV_SECTIONS = [
  { id: 'main', label: null },
  { id: 'search', label: 'Job search' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'settings', label: 'Settings' },
  { id: 'admin', label: 'Administration' },
];
