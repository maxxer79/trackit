import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#1c1c1e',
              color: '#fff',
              border: '1px solid #38383a',
              borderRadius: '14px',
              fontSize: '15px',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            },
            success: {
              iconTheme: { primary: '#30d158', secondary: '#000' },
            },
            error: {
              iconTheme: { primary: '#ff3b30', secondary: '#000' },
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
