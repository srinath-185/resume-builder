import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { canSee, selectRole, selectToken } from './authSlice';
import { APP_ROUTES } from './routes';
import AppLayout from '@/layouts/AppLayout';
import Login from '@/screens/Auth/Login';
import Register from '@/screens/Auth/Register';
import NotFound from '@/screens/NotFound';

export function RequireAuth({ children }) {
  const token = useSelector(selectToken);
  const location = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

/** Hides role-restricted pages from other users; the API refuses their requests regardless. */
export function RequireRole({ route, children }) {
  const role = useSelector(selectRole);
  return canSee(route, role) ? children : <NotFound />;
}

export function routeConfig() {
  return [
    { path: '/login', element: <Login /> },
    { path: '/register', element: <Register /> },
    {
      element: (
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      ),
      children: [
        ...APP_ROUTES.map(route => ({ path: route.path, element: route.roles ? <RequireRole route={route}>{route.element}</RequireRole> : route.element })),
        { path: '*', element: <NotFound /> },
      ],
    },
  ];
}

export const router = createBrowserRouter(routeConfig(), { future: { v7_relativeSplatPath: true } });
