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
import { MerchantPortal } from './uaepass/Portal';
import { SimLogin, SimShare, SimSign } from './uaepass/Sim';
import { PoweredByMoneyBee, TenantMark, useTenantTheme, type PublicTenant } from './tenant';

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);
const TenantCtx = createContext<PublicTenant | null>(null);
/** tenant of the signed-in user (brand, enabled company types, kind) */
export const useTenant = () => useContext(TenantCtx);

/** Public tenant for pages shown before sign-in: ?tenant= in the page URL wins, otherwise the server uses the host name. */
export function publicTenantPath() {
  const explicit = new URLSearchParams(window.location.search).get('tenant');
  return `/public/tenant${explicit ? `?tenant=${encodeURIComponent(explicit)}` : ''}`;
}

/** Public screens (no ops login): the merchant portal and the simulated UAE PASS app. */
export function App() {
  return (
    <Routes>
      <Route path="/m" element={<MerchantPortal />} />
      <Route path="/m/:invite" element={<MerchantPortal />} />
      <Route path="/sim/uaepass/login" element={<SimLogin />} />
      <Route path="/sim/uaepass/share/:no" element={<SimShare />} />
      <Route path="/sim/uaepass/sign" element={<SimSign />} />
      <Route path="*" element={<OpsApp />} />
    </Routes>
  );
}

function OpsApp() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: Me; tenant: PublicTenant }>('/auth/me'), retry: false });
  const pub = useQuery({ queryKey: ['public-tenant'], queryFn: () => api.get<{ tenant: PublicTenant }>(publicTenantPath()).then((r) => r.tenant), enabled: !me.isLoading && !me.data, staleTime: 60_000 });
  const tenant = me.data?.tenant ?? pub.data ?? null;
  useTenantTheme(tenant);
  if (me.isLoading) return <div className="login"><span className="muted">Loading</span></div>;
  if (!me.data) return <Login tenant={tenant} onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />;
  const user = me.data.user;
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
    <MeCtx.Provider value={user}>
      <TenantCtx.Provider value={me.data.tenant}>
      <div className="shell">
        <header className="topbar">
          <nav className="nav-glass" aria-label="Main">
            <NavLink to="/" style={{ textDecoration: 'none' }} aria-label={`${me.data.tenant.branding.displayName} ${me.data.tenant.branding.productName} home`}><TenantMark tenant={me.data.tenant} /></NavLink>
            <div className="nav-links">
              {links.map(([to, l]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{l}</NavLink>)}
            </div>
            <div className="nav-right">
              <span className="hide-sm">{user.name} <span className="pill">{user.role.replace('_', ' ')}</span></span>
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
        <PoweredByMoneyBee />
      </div>
      </TenantCtx.Provider>
    </MeCtx.Provider>
  );
}
