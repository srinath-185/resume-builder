import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectToken } from './authSlice';
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
      children: [...APP_ROUTES.map(({ path, element }) => ({ path, element })), { path: '*', element: <NotFound /> }],
    },
  ];
}

export const router = createBrowserRouter(routeConfig(), { future: { v7_relativeSplatPath: true } });
