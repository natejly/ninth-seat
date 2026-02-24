import { useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined;

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...options,
    headers,
  });

  return response;
}

function DotField() {
  const canvasRef = useRef(null);
  const pointerRef = useRef({ x: -1000, y: -1000, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    let rafId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (event) => {
      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        active: true,
      };
    };

    const onLeave = () => {
      pointerRef.current = {
        ...pointerRef.current,
        active: false,
      };
    };

    const draw = () => {
      const now = performance.now() * 0.001;
      const spacing = 24;
      const influenceRadius = 180;
      const { x, y, active } = pointerRef.current;

      ctx.clearRect(0, 0, width, height);

      for (let py = -spacing; py <= height + spacing; py += spacing) {
        for (let px = -spacing; px <= width + spacing; px += spacing) {
          const dx = x - px;
          const dy = y - py;
          const distance = Math.hypot(dx, dy);
          const influence = active
            ? Math.max(0, 1 - distance / influenceRadius)
            : 0;

          const pulse = 0.25 + 0.1 * Math.sin((px + py) * 0.03 + now * 2.2);
          const radius = 1.15 + pulse + influence * 2.6;
          const alpha = 0.12 + influence * 0.45;

          let offsetX = 0;
          let offsetY = 0;
          if (active && distance > 0.0001) {
            const pull = influence * 3.25;
            offsetX = (dx / distance) * pull;
            offsetY = (dy / distance) * pull;
          }

          ctx.beginPath();
          ctx.arc(px + offsetX, py + offsetY, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(196, 201, 209, ${alpha})`;
          ctx.fill();
        }
      }

      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="dot-field" aria-hidden="true" />;
}

function LoginCard({ password, onPasswordChange, onSubmit, loading, error }) {
  return (
    <section className="panel" aria-labelledby="login-title">
      <h1 id="login-title" className="login-title">
        Enter password
      </h1>

      <form onSubmit={onSubmit} className="login-form">
        <input
          id="password"
          type="password"
          aria-label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="password"
          className="input"
          disabled={loading}
        />

        <p className={error ? 'error' : 'hint'} role={error ? 'alert' : undefined}>
          {error || ' '}
        </p>

        <button type="submit" className="button" disabled={loading}>
          {loading ? 'Verifying…' : 'Enter'}
        </button>
      </form>
    </section>
  );
}

function HomeCard({ message, onLogout, loading }) {
  return (
    <section className="panel home-panel" aria-labelledby="home-title">
      <div className="chip">authenticated session</div>
      <h1 id="home-title">Home</h1>
      <p className="home-message">{message || 'nothing here yet'}</p>
      <button type="button" className="button ghost" onClick={onLogout} disabled={loading}>
        {loading ? 'Signing out…' : 'Logout'}
      </button>
    </section>
  );
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [homeMessage, setHomeMessage] = useState('');

  const loadHomeMessage = async () => {
    const response = await apiFetch('/api/home');
    if (!response.ok) {
      throw new Error('Unable to load home page');
    }
    const data = await response.json();
    setHomeMessage(data.message || 'nothing here yet');
  };

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const response = await apiFetch('/api/session');
        if (!response.ok) {
          throw new Error('Session check failed');
        }
        const data = await response.json();
        if (!active) return;

        setAuthenticated(Boolean(data.authenticated));
        if (data.authenticated) {
          await loadHomeMessage();
        }
      } catch {
        if (!active) return;
        setAuthenticated(false);
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    };

    checkSession();

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || 'Invalid password');
      }

      setAuthenticated(true);
      setPassword('');
      await loadHomeMessage();
    } catch (err) {
      setAuthenticated(false);
      setHomeMessage('');
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      await apiFetch('/api/logout', { method: 'POST' });
    } finally {
      setAuthenticated(false);
      setHomeMessage('');
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <DotField />
      <div className="ambient ambient-a" aria-hidden="true" />
      <div className="ambient ambient-b" aria-hidden="true" />

      {!authChecked ? (
        <section className="panel loading-panel">
          <div className="chip">initializing</div>
          <p className="subtitle">Checking session…</p>
        </section>
      ) : authenticated ? (
        <HomeCard message={homeMessage} onLogout={handleLogout} loading={loading} />
      ) : (
        <LoginCard
          password={password}
          onPasswordChange={setPassword}
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />
      )}
    </main>
  );
}

export default App;
