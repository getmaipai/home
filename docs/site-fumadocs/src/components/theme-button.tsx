'use client';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// One round button, top right: switches light and dark.
export function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const dark = ready && resolvedTheme === 'dark';
  return (
    <button
      type="button"
      className="theme-button"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
