import clsx from 'clsx';
import { FileText, LogOut, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Outlet } from 'react-router-dom';
import { useMeQuery } from '@/app/api/auth';
import { canSee, loggedOut, selectRole, selectUser, userRefreshed } from '@/app/authSlice';
import { APP_ROUTES, NAV_SECTIONS } from '@/app/routes';

function NavItems({ onNavigate }) {
  const role = useSelector(selectRole);
  return (
    <nav className="space-y-5">
      {NAV_SECTIONS.map(section => {
        const items = APP_ROUTES.filter(route => route.nav?.section === section.id && canSee(route, role));
        if (items.length === 0) return null;
        return (
          <div key={section.id}>
            {section.label && <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.label}</p>}
            <ul className="space-y-0.5">
              {items.map(route => {
                const Icon = route.nav.icon;
                return (
                  <li key={route.path}>
                    <NavLink
                      to={route.path}
                      end={route.path === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        clsx('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100')
                      }
                    >
                      {Icon && <Icon className="size-4" aria-hidden />}
                      {route.nav.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export default function AppLayout() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const user = useSelector(selectUser);
  const [open, setOpen] = useState(false);
  // The stored profile can be stale (e.g. a role granted since sign-in).
  const { data: me } = useMeQuery();
  useEffect(() => {
    if (me && (me.role !== user?.role || me.name !== user?.name)) dispatch(userRefreshed(me));
  }, [me, user, dispatch]);

  return (
    <div className="flex min-h-full">
      <aside
        className={clsx(
          // Scrolls on its own so every link stays reachable on short screens.
          'fixed inset-y-0 left-0 z-40 w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 bg-white p-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex items-center gap-2 px-2 text-base font-semibold text-slate-900">
          <FileText className="size-5 text-brand-600" aria-hidden />
          Resume Builder
        </div>
        <NavItems onNavigate={() => setOpen(false)} />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <button type="button" className="rounded p-1 lg:hidden" onClick={() => setOpen(true)} aria-label={t('layout.openMenu', 'Open menu')}>
            <Menu className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">{user?.name}</span>
            <button type="button" onClick={() => dispatch(loggedOut())} className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-600 hover:bg-slate-100">
              <LogOut className="size-4" aria-hidden />
              {t('layout.signOut', 'Sign out')}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
