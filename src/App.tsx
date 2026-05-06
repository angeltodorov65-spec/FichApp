/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Component } from 'react';
import { AuthProvider, useAuth } from './components/AuthWrapper';
import { EmployeeDashboard } from './components/EmployeeDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { Button } from '@/components/ui/button';
import { User, ShieldCheck, Sun, Moon } from 'lucide-react';
import i18n from './i18n';
import { cn } from '@/lib/utils';

// Simple Error Boundary
class ErrorBoundary extends Component<any, any> {
  state: any;
  props: any;

  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center bg-zinc-50 p-4 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Something went wrong</h1>
          <p className="text-zinc-500 mb-6 max-w-md">The application encountered a serious problem and could not load the display.</p>
          <pre className="p-4 bg-zinc-100 rounded text-xs overflow-auto max-w-full mb-6">
            {this.state.error?.toString()}
          </pre>
          <Button onClick={() => window.location.reload()}>
            Reload Application
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

function MainContent() {
  const { profile, loading, user } = useAuth();
  const [view, setView] = useState<'auto' | 'employee' | 'admin'>('auto');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin text-zinc-400 border-4 border-zinc-200 dark:border-zinc-800 border-t-zinc-900 dark:border-t-zinc-100 rounded-full" />
          <p className="text-zinc-500 dark:text-zinc-400 text-sm animate-pulse">{i18n.t('Loading...')}</p>
        </div>
      </div>
    );
  }

  if (user && !profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
          <ShieldCheck className="h-12 w-12 text-zinc-300 dark:text-zinc-700" />
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{i18n.t('Profile Syncing')}</h2>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            {i18n.t('Your profile data is being loaded. Please wait a moment.')}
          </p>
                  <Button variant="ghost" onClick={() => window.location.reload()} className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
            Refresh Page
          </Button>
        </div>
      </div>
    );
  }

  if (!profile) return null;
  
  const isAdmin = profile.role === 'admin' || profile.role === 'manager';
  const currentView = view === 'auto' ? (isAdmin ? 'admin' : 'employee') : view;

  return (
    <div className="relative min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
      {/* Persistent Theme Toggle - Bottom Right */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full h-12 w-12 shadow-2xl bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:scale-110 transition-all active:scale-95"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? (
            <Sun className="h-6 w-6 text-yellow-400 fill-yellow-400/20" />
          ) : (
            <Moon className="h-6 w-6 text-indigo-600 fill-indigo-600/10" />
          )}
        </Button>
      </div>
      
      <div className="relative">
        {currentView === 'admin' ? (
          <AdminDashboard profile={profile} currentView={currentView} setView={setView} />
        ) : (
          <EmployeeDashboard profile={profile} currentView={currentView} setView={setView} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <MainContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

