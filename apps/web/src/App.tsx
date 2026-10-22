import { createContext, useContext, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Me } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { NewCase } from './pages/NewCase';
import { CaseWorkspace } from './pages/CaseWorkspace';
import { Settings } from './pages/Settings';
import { Toaster } from './components/ui';

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

export function App() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: Me }>('/auth/me').then((r) => r.user), retry: false });
  if (me.isLoading) return <div className="login"><span className="muted">Loading</span></div>;
  if (!me.data) return <Login onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    nav('/');
  };
  const links = [
    ['/', 'Cases'],
    ['/new', 'New case'],
    ['/settings', 'Settings'],
  ];
  return (
    <MeCtx.Provider value={me.data}>
      <div className="shell">
        <header className="topbar">
          <nav className="nav-glass" aria-label="Main">
            <NavLink to="/" className="wordmark" aria-label="MoneyBee Onboard home">moneybee <small>Onboard</small></NavLink>
            <div className="nav-links">
              {links.map(([to, l]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{l}</NavLink>)}
            </div>
            <div className="nav-right">
              <span className="hide-sm">{me.data.name} <span className="pill">{me.data.role.replace('_', ' ')}</span></span>
              <button className="btn btn-dark btn-sm hide-sm" onClick={logout}>Sign out</button>
              <button className="btn btn-sm" style={{ display: 'none' }} id="menu-btn" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu(!menu)}>☰</button>
            </div>
          </nav>
          {menu && (
            <div className="card" style={{ marginTop: 8, padding: 12 }}>
              <div className="stack">
                {links.map(([to, l]) => <NavLink key={to} to={to} onClick={() => setMenu(false)}>{l}</NavLink>)}
                <button className="btn btn-dark btn-sm" onClick={logout}>Sign out</button>
              </div>
            </div>
          )}
        </header>
        <style>{`@media (max-width: 860px){#menu-btn{display:inline-flex!important}}`}</style>
        <Toaster />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<NewCase />} />
            <Route path="/cases/:id" element={<CaseWorkspace />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </MeCtx.Provider>
  );
}
