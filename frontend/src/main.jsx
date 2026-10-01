import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/router';
import { store } from '@/app/store';
import '@/common/i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Provider>
  </React.StrictMode>,
);
