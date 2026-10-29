import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, Bell, Check, CheckCircle2,
  ChevronDown, Clock3, HeartHandshake, Leaf, MapPin, Menu, PackageCheck,
  Plus, Search, ShieldAlert, SlidersHorizontal, Sparkles, Store, Trash2, Truck, Utensils,
  X,
} from 'lucide-react';

type Role = 'donor' | 'recipient' | 'admin';
type User = { id: number; name: string; email: string; role: Role; organization: string; phone: string; address: string; serviceArea: string };
type Listing = {
  id: number; donor_id: number; name: string; description: string; category: string; quantity: number; unit: string;
  preparedAt: string; pickupLocation: string; pickupStart: string; pickupEnd: string; useBy: string;
  handling: string; allergens: string; status: string; donorName: string; donorOrganization: string; donorPhone: string; requestCount: number;
};
type DonationRequest = {
  id: number; listing_id: number; recipient_id: number; status: string; message: string; listingName: string;
  category: string; quantity: number; unit: string; pickupLocation: string; pickupStart: string; pickupEnd: string;
  useBy: string; handling: string; allergens: string; donorOrganization: string; donorName: string; donorPhone: string;
  recipientOrganization: string; recipientName: string; recipientPhone: string; createdAt: string;
};
type Report = { id: number; listing_id: number; reason: string; details: string; status: string; listing_name: string; reporter_organization: string; created_at: string };
type ModalState = { kind: 'listing'; listing?: Listing } | { kind: 'report'; listing: Listing } | { kind: 'profile' } | { kind: 'confirm'; request: DonationRequest; action: 'pickup' | 'complete' } | { kind: 'admin'; report: Report; action: 'dismiss' | 'remove' } | null;

const categories = ['Prepared meals', 'Produce', 'Bakery', 'Dairy', 'Pantry', 'Other'];
const api = async <T,>(path: string, token: string | null, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to reach Harvest Share. Please try again.');
  return payload as T;
};
const formatDate = (value: string, withTime = true) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(value)) : 'Not provided';
const localInput = (value?: string) => {
  const date = value ? new Date(value) : new Date(Date.now() + 2 * 3600000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const statusLabel = (status: string) => status.replaceAll('_', ' ');

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('harvest-token'));
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem('harvest-token')));
  const [activeTab, setActiveTab] = useState('overview');
  const [listings, setListings] = useState<Listing[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [requests, setRequests] = useState<DonationRequest[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [requestFilter, setRequestFilter] = useState('all');
  const [mobileNav, setMobileNav] = useState(false);

  const loadData = async (currentToken = token) => {
    if (!currentToken) return;
    try {
      const [listingData, requestData] = await Promise.all([
        api<{ listings: Listing[] }>('/listings', currentToken),
        api<{ requests: DonationRequest[] }>('/requests', currentToken),
      ]);
      setListings(listingData.listings);
      setRequests(requestData.requests);
      if (user?.role === 'admin') {
        const reportData = await api<{ reports: Report[] }>('/reports', currentToken);
        setReports(reportData.reports);
      }
      setDataLoaded(true);
      setError('');
    } catch (issue) { setDataLoaded(true); setError(issue instanceof Error ? issue.message : 'Could not load your workspace.'); }
  };

  useEffect(() => {
    if (!token) { setAuthLoading(false); return; }
    let mounted = true;
    api<{ user: User }>('/me', token).then(({ user: current }) => {
      if (mounted) { setUser(current); setAuthLoading(false); }
    }).catch(() => {
      localStorage.removeItem('harvest-token');
      if (mounted) { setToken(null); setUser(null); setAuthLoading(false); }
    });
    return () => { mounted = false; };
  }, [token]);

  useEffect(() => { if (user && token) void loadData(token); }, [user, token]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const signIn = (newToken: string, newUser: User) => {
    localStorage.setItem('harvest-token', newToken);
    setToken(newToken);
    setUser(newUser);
    setActiveTab('overview');
    setError('');
  };
  const signOut = () => {
    localStorage.removeItem('harvest-token');
    setToken(null); setUser(null); setListings([]); setRequests([]); setReports([]);
    setDataLoaded(false);
    setActiveTab('overview'); setRequestFilter('all'); setQuery(''); setCategoryFilter(''); setLocationFilter('');
  };
  const perform = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true); setError('');
    try { await task(); setModal(null); setNotice(success); await loadData(); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  if (authLoading) return <div className="loading-screen"><div className="brand-mark"><Leaf size={22} /></div><p>Opening your community table…</p></div>;
  if (!user || !token) return <AuthScreen onSignIn={signIn} />;

  const navItems = user.role === 'donor'
    ? [{ id: 'overview', label: 'Overview', icon: Sparkles }, { id: 'listings', label: 'My listings', icon: Store }, { id: 'requests', label: 'Requests', icon: HeartHandshake }, { id: 'profile', label: 'Organization profile', icon: BadgeCheck }]
    : user.role === 'recipient'
      ? [{ id: 'overview', label: 'Find food', icon: Search }, { id: 'requests', label: 'My requests', icon: HeartHandshake }, { id: 'profile', label: 'Organization profile', icon: BadgeCheck }]
      : [{ id: 'overview', label: 'Overview', icon: Sparkles }, { id: 'reports', label: 'Review reports', icon: ShieldAlert }];
  const availableListings = listings.filter((listing) => ['available', 'requested'].includes(listing.status));
  const filteredListings = availableListings.filter((listing) => {
    const matchesText = `${listing.name} ${listing.description} ${listing.donorOrganization}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = !categoryFilter || listing.category === categoryFilter;
    const matchesLocation = !locationFilter || listing.pickupLocation.toLowerCase().includes(locationFilter.toLowerCase());
    return matchesText && matchesCategory && matchesLocation;
  });
  const filteredRequests = requests.filter((request) => requestFilter === 'all' || request.status === requestFilter);
  const pendingCount = requests.filter((request) => request.status === 'pending').length;
  const completedCount = requests.filter((request) => request.status === 'completed').length;
  const activeCount = requests.filter((request) => ['accepted', 'picked_up'].includes(request.status)).length;
  const openReports = reports.filter((report) => report.status === 'open').length;

  const actionRequest = (request: DonationRequest, action: string) => perform(
    () => api(`/requests/${request.id}/action`, token, { method: 'POST', body: JSON.stringify({ action }) }),
    action === 'accept' ? 'Pickup request accepted.' : action === 'reject' ? 'Request declined.' : action === 'cancel' ? 'Request cancelled.' : action === 'pickup' ? 'Pickup confirmed.' : 'Donation marked complete.',
  );
  const title = activeTab === 'overview' ? (user.role === 'recipient' ? 'Food near you' : user.role === 'admin' ? 'Community pulse' : 'Today at a glance')
    : activeTab === 'listings' ? 'Your food listings' : activeTab === 'requests' ? (user.role === 'donor' ? 'Incoming requests' : 'Your pickup requests')
      : activeTab === 'reports' ? 'Listing reports' : 'Organization profile';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setActiveTab('overview'); }}>
          <span className="brand-mark"><Leaf size={21} strokeWidth={2.2} /></span>
          <span>harvest<span className="brand-light">share</span><small>GOOD FOOD, GOOD NEIGHBORS</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="nav-list" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activeTab === id ? 'active' : ''}`} onClick={() => { setActiveTab(id); setMobileNav(false); }}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'requests' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
          </button>)}
        </div>
        <div className="sidebar-bottom">
          <div className="safety-card"><div className="safety-icon"><ShieldAlert size={16} /></div><strong>Food safety comes first</strong><p>Every organization is responsible for following local food-safety rules.</p><button onClick={() => setActiveTab('safety')}>Read our guidelines <ArrowRight size={14} /></button></div>
          <button className="user-mini" onClick={() => setActiveTab('profile')}><span className="avatar">{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span className="user-mini-copy"><strong>{user.organization}</strong><small>{user.role === 'admin' ? 'Platform admin' : user.role === 'donor' ? 'Food donor' : 'Community partner'}</small></span><ChevronDown size={16} /></button>
        </div>
      </aside>
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={21} /></button>
          <div className="breadcrumb"><span>Harvest Share</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-right"><span className="date-pill"><span className="live-dot" />Community network live</span><button className="icon-button notification-button" aria-label={`${pendingCount} pending requests`} onClick={() => setActiveTab(user.role === 'recipient' ? 'requests' : 'requests')}><Bell size={18} />{pendingCount > 0 && <i />}</button><button className="top-avatar" onClick={signOut} title="Sign out">{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</button></div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div><p className="eyebrow">{user.role === 'recipient' ? 'BROOKHAVEN COMMUNITY NETWORK' : user.role === 'admin' ? 'PLATFORM OPERATIONS' : 'YOUR DONATION DESK'}</p><h1>{title}</h1><p className="heading-subtitle">{activeTab === 'overview' && user.role === 'recipient' ? 'Surplus food shared by your neighbors, ready for pickup.' : activeTab === 'overview' ? 'A little coordination makes a meaningful difference.' : activeTab === 'requests' ? 'Keep every handoff clear, timely, and confirmed.' : activeTab === 'reports' ? 'Review community reports and record each decision.' : 'Keep your community information up to date.'}</p></div>
            {user.role === 'donor' && activeTab !== 'profile' && <button className="button button-primary" onClick={() => setModal({ kind: 'listing' })}><Plus size={17} /> Share food</button>}
          </div>

          {error && <div className="alert alert-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
          {notice && <div className="toast" role="status"><CheckCircle2 size={18} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}

          {activeTab === 'overview' && user.role === 'recipient' && <RecipientDiscovery listings={filteredListings} query={query} setQuery={setQuery} category={categoryFilter} setCategory={setCategoryFilter} location={locationFilter} setLocation={setLocationFilter} loading={!dataLoaded} onRequest={(listing) => perform(() => api(`/listings/${listing.id}/requests`, token, { method: 'POST', body: JSON.stringify({}) }), 'Request sent to the donor.')} onReport={(listing) => setModal({ kind: 'report', listing })} />}
          {activeTab === 'overview' && user.role !== 'recipient' && <section className="overview-view">
            <div className="welcome-band"><div><div className="welcome-kicker"><span className="welcome-star"><Sparkles size={14} /></span> SMALL ACTS, SHARED OFTEN</div><h2>{user.role === 'admin' ? 'A clearer view of community giving.' : 'Make good food go further.'}</h2><p>{user.role === 'admin' ? 'Keep donations moving with clear, accountable moderation.' : 'Your next donation can make someone’s day a little easier.'}</p></div><div className="welcome-art" aria-hidden="true"><div className="plate"><Utensils size={52} strokeWidth={1.2} /></div><span className="art-leaf leaf-one"><Leaf size={29} /></span><span className="art-leaf leaf-two"><Leaf size={20} /></span><span className="art-sun" /></div></div>
            <div className="stat-grid">
              <StatCard label={user.role === 'admin' ? 'Open reports' : 'Pending requests'} value={user.role === 'admin' ? openReports : pendingCount} detail={user.role === 'admin' ? 'Needs a review' : 'Awaiting a response'} icon={user.role === 'admin' ? ShieldAlert : Clock3} color="gold" />
              <StatCard label="In progress" value={activeCount} detail="Accepted or picked up" icon={Truck} color="green" />
              <StatCard label="Completed" value={completedCount} detail="Confirmed handoffs" icon={PackageCheck} color="coral" />
              <StatCard label={user.role === 'admin' ? 'Food listings' : 'Your listings'} value={listings.length} detail="Across your workspace" icon={Store} color="blue" />
            </div>
            <div className="section-heading"><div><p className="eyebrow">KEEP THINGS MOVING</p><h2>{user.role === 'admin' ? 'Needs your attention' : 'Recent activity'}</h2></div><button className="text-button" onClick={() => setActiveTab(user.role === 'admin' ? 'reports' : 'requests')}>View all <ArrowRight size={15} /></button></div>
            {user.role === 'admin' ? <ReportsList reports={reports.filter((report) => report.status === 'open').slice(0, 3)} onReview={(report) => setModal({ kind: 'admin', report, action: 'dismiss' })} /> : <RequestsList requests={requests.slice(0, 4)} user={user} onAction={actionRequest} onConfirm={(request, action) => setModal({ kind: 'confirm', request, action })} />}
          </section>}
          {activeTab === 'listings' && <DonorListings listings={listings} onCreate={() => setModal({ kind: 'listing' })} onEdit={(listing) => setModal({ kind: 'listing', listing })} onRemove={(listing) => perform(() => api(`/listings/${listing.id}`, token, { method: 'DELETE' }), 'Listing removed.')} onRequests={() => { setActiveTab('requests'); setRequestFilter('pending'); }} />}
          {activeTab === 'requests' && <section className="requests-view"><div className="filter-row"><div className="filter-tabs" role="group" aria-label="Filter requests">{['all', 'pending', 'accepted', 'picked_up', 'completed', 'rejected', 'cancelled'].map((status) => <button key={status} className={requestFilter === status ? 'selected' : ''} onClick={() => setRequestFilter(status)}>{status === 'all' ? 'All requests' : statusLabel(status)}</button>)}</div><span className="result-count">{filteredRequests.length} {filteredRequests.length === 1 ? 'request' : 'requests'}</span></div><RequestsList requests={filteredRequests} user={user} onAction={actionRequest} onConfirm={(request, action) => setModal({ kind: 'confirm', request, action })} /></section>}
          {activeTab === 'profile' && <ProfilePanel user={user} onEdit={() => setModal({ kind: 'profile' })} onSignOut={signOut} />}
          {activeTab === 'reports' && <section className="reports-view"><div className="report-summary"><span className="summary-icon"><ShieldAlert size={19} /></span><div><strong>{openReports} open reports</strong><p>Every moderation decision is recorded for accountability.</p></div></div><ReportsList reports={reports} onReview={(report) => setModal({ kind: 'admin', report, action: 'dismiss' })} /></section>}
          {activeTab === 'safety' && <SafetyPage />}
          <footer className="page-footer"><span><span className="footer-leaf"><Leaf size={14} /></span> Food shared with care, neighbors connected.</span><button onClick={() => setActiveTab('safety')}>Safety & responsibility <ArrowRight size={14} /></button><span>Demo environment · Fictional details</span></footer>
        </div>
      </main>
      {modal && <Modal onClose={() => { if (!busy) { setModal(null); setError(''); } }}>
        {error && <div className="alert alert-error modal-alert" role="alert"><AlertCircle size={16} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
        {modal.kind === 'listing' && <ListingForm listing={modal.listing} busy={busy} onCancel={() => setModal(null)} onSubmit={(data) => perform(() => api(modal.listing ? `/listings/${modal.listing.id}` : '/listings', token, { method: modal.listing ? 'PUT' : 'POST', body: JSON.stringify(data) }), modal.listing ? 'Listing updated.' : 'Your food is now listed for pickup.')} />}
        {modal.kind === 'report' && <ReportForm listing={modal.listing} busy={busy} onCancel={() => setModal(null)} onSubmit={(data) => perform(() => api(`/listings/${modal.listing.id}/reports`, token, { method: 'POST', body: JSON.stringify(data) }), 'Report sent to the admin team.')} />}
        {modal.kind === 'profile' && <ProfileForm user={user} busy={busy} onCancel={() => setModal(null)} onSubmit={async (data) => { await perform(async () => { const response = await api<{ user: User }>('/profile', token, { method: 'PATCH', body: JSON.stringify(data) }); setUser(response.user); }, 'Organization profile updated.'); }} />}
        {modal.kind === 'confirm' && <ConfirmAction request={modal.request} action={modal.action} busy={busy} onCancel={() => setModal(null)} onConfirm={() => actionRequest(modal.request, modal.action)} />}
        {modal.kind === 'admin' && <AdminReview report={modal.report} busy={busy} onCancel={() => setModal(null)} onSubmit={(action, note) => perform(() => api(`/reports/${modal.report.id}/action`, token, { method: 'POST', body: JSON.stringify({ action, note }) }), action === 'remove' ? 'Listing removed and action recorded.' : 'Report dismissed and action recorded.')} />}
      </Modal>}
    </div>
  );
}

function AuthScreen({ onSignIn }: { onSignIn: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [role, setRole] = useState<'donor' | 'recipient'>('recipient');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', organization: '', phone: '', address: '', serviceArea: '' });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = mode === 'login' ? { email: form.email, password: form.password } : { ...form, role };
      const result = await api<{ token: string; user: User }>('/auth/' + (mode === 'login' ? 'login' : 'register'), null, { method: 'POST', body: JSON.stringify(payload) });
      onSignIn(result.token, result.user);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Sign in failed.'); }
    finally { setBusy(false); }
  };
  const demo = async (email: string) => {
    setBusy(true); setError('');
    try {
      const result = await api<{ token: string; user: User }>('/auth/login', null, { method: 'POST', body: JSON.stringify({ email, password: 'Harvest2026!' }) });
      onSignIn(result.token, result.user);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Sign in failed.'); }
    finally { setBusy(false); }
  };
  return <main className="auth-page"><section className="auth-story"><a className="brand auth-brand" href="#home"><span className="brand-mark"><Leaf size={21} /></span><span>harvest<span className="brand-light">share</span><small>GOOD FOOD, GOOD NEIGHBORS</small></span></a><div className="story-copy"><p className="eyebrow">A NEIGHBORHOOD FOOD NETWORK</p><h1>Good food<br /><em>finds its way.</em></h1><p className="story-lede">A simple way for local kitchens and community organizations to share what’s fresh, together.</p><div className="story-stat"><div className="story-avatars"><span>MC</span><span>AB</span><span>TM</span><b>+</b></div><div><strong>One table. Many neighbors.</strong><small>Thoughtful donations, coordinated pickups.</small></div></div></div><div className="story-note"><span className="note-line" /> Made for the moments that matter <span>·</span> Brookhaven, everywhere</div><div className="auth-decoration" aria-hidden="true"><span className="decoration-ring" /><span className="decoration-dot" /><span className="decoration-leaf"><Leaf size={88} /></span></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-auth-mark"><Leaf size={19} /> harvestshare</div><p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'JOIN THE NETWORK'}</p><h2>{mode === 'login' ? 'Your community awaits.' : 'Let’s get started.'}</h2><p className="auth-subtitle">{mode === 'login' ? 'Sign in to coordinate your next food handoff.' : 'Create an organization account to share or find food.'}</p>
      {error && <div className="alert alert-error auth-error" role="alert"><AlertCircle size={17} />{error}</div>}
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && <><div className="role-switch" role="group" aria-label="Account type"><button type="button" className={role === 'recipient' ? 'selected' : ''} onClick={() => setRole('recipient')}><HeartHandshake size={16} />Recipient</button><button type="button" className={role === 'donor' ? 'selected' : ''} onClick={() => setRole('donor')}><Store size={16} />Donor</button></div><label>Your name<input required minLength={2} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Jordan Lee" /></label><label>Organization name<input required minLength={2} value={form.organization} onChange={(event) => update('organization', event.target.value)} placeholder="Community Table" /></label></>}
        <label>Email address<input required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="you@organization.org" autoComplete="email" /></label>
        <label>Password<input required type="password" minLength={8} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'register' && <><label>Organization phone<input required type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="(555) 010-1234" /></label><label>Pickup or service address<input required value={form.address} onChange={(event) => update('address', event.target.value)} placeholder="12 Garden Lane, Brookhaven" /></label>{role === 'recipient' && <label>Service area<input value={form.serviceArea} onChange={(event) => update('serviceArea', event.target.value)} placeholder="Northside, Central" /></label>}</>}
        <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={17} /></button>
      </form>
      <p className="auth-toggle">{mode === 'login' ? 'New to the network?' : 'Already part of the network?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
      <div className="demo-login"><div className="demo-heading"><span>QUICK DEMO ACCESS</span><span className="demo-divider" /></div><div className="demo-buttons"><button disabled={busy} onClick={() => void demo('donor@harvest.test')}><Store size={15} />Donor</button><button disabled={busy} onClick={() => void demo('shelter@harvest.test')}><HeartHandshake size={15} />Recipient</button><button disabled={busy} onClick={() => void demo('admin@harvest.test')}><ShieldAlert size={15} />Admin</button></div><small>Demo password: Harvest2026!</small></div>
      <p className="auth-disclaimer"><ShieldAlert size={14} />Harvest Share coordinates donations. We do not inspect or certify food as safe.</p>
    </div><div className="auth-footer">© 2026 Harvest Share <span>·</span> Fictional demo details throughout</div></section>
  </main>;
}

function StatCard({ label, value, detail, icon: Icon, color }: { label: string; value: number; detail: string; icon: typeof Store; color: string }) {
  return <article className="stat-card"><span className={`stat-icon ${color}`}><Icon size={18} strokeWidth={1.9} /></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function RecipientDiscovery({ listings, query, setQuery, category, setCategory, location, setLocation, loading, onRequest, onReport }: {
  listings: Listing[]; query: string; setQuery: (value: string) => void; category: string; setCategory: (value: string) => void;
  location: string; setLocation: (value: string) => void; loading: boolean; onRequest: (listing: Listing) => void; onReport: (listing: Listing) => void;
}) {
  const [selected, setSelected] = useState<Listing | null>(null);
  return <section className="discovery-view"><div className="discovery-banner"><div><div className="banner-kicker"><MapPin size={14} /> BROOKHAVEN & NEARBY</div><h2>Freshly shared.<br /><span>Ready for your table.</span></h2><p>Pickup details and handling notes come directly from each donor.</p></div><div className="banner-illustration" aria-hidden="true"><div className="produce-bowl"><span className="produce tomato" /><span className="produce carrot" /><span className="produce green" /><span className="bowl" /></div><span className="banner-sparkle sparkle-a">✳</span><span className="banner-sparkle sparkle-b">✦</span></div></div>
    <div className="discovery-toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search food or kitchen" aria-label="Search food or kitchen" />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button>}</div><div className="select-wrap"><SlidersHorizontal size={15} /><select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></div><div className="search-box location-search"><MapPin size={17} /><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Area or address" aria-label="Filter by pickup area" />{location && <button aria-label="Clear location" onClick={() => setLocation('')}><X size={15} /></button>}</div><span className="listing-count"><strong>{listings.length}</strong> available</span></div>
    {loading ? <div className="loading-state"><span className="spinner" />Finding food nearby…</div> : listings.length ? <div className="listing-grid">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} onSelect={() => setSelected(listing)} onRequest={() => onRequest(listing)} onReport={() => onReport(listing)} />)}</div> : <EmptyState icon={Search} title="No food found just yet" body="Try clearing a filter or check back soon. New donations appear throughout the day." />}
    {selected && <ListingDetail listing={selected} onClose={() => setSelected(null)} onRequest={() => { setSelected(null); onRequest(selected); }} onReport={() => { setSelected(null); onReport(selected); }} />}
  </section>;
}

function ListingCard({ listing, onSelect, onRequest, onReport }: { listing: Listing; onSelect: () => void; onRequest: () => void; onReport: () => void }) {
  const remaining = Math.max(0, Math.ceil((new Date(listing.pickupEnd).getTime() - Date.now()) / 3600000));
  return <article className="listing-card"><div className={`food-art food-art-${listing.category === 'Bakery' ? 'bakery' : listing.category === 'Produce' ? 'produce' : listing.category === 'Prepared meals' ? 'meal' : 'other'}`} aria-hidden="true"><span className="food-art-symbol">{listing.category === 'Bakery' ? '✳' : listing.category === 'Produce' ? '◉' : listing.category === 'Prepared meals' ? '◒' : '✦'}</span><span className="food-art-category">{listing.category}</span><button className="card-report" aria-label={`Report ${listing.name}`} title="Report listing" onClick={onReport}><ShieldAlert size={15} /></button></div><div className="listing-card-body"><div className="listing-card-top"><span className="donor-label"><span className="tiny-leaf"><Leaf size={11} /></span>{listing.donorOrganization}</span>{listing.status === 'requested' && <span className="pending-tag">Requests open</span>}</div><button className="listing-title-button" onClick={onSelect}><h3>{listing.name}</h3></button><p className="listing-description">{listing.description}</p><div className="listing-facts"><div className="quantity-fact"><span className="fact-icon"><PackageCheck size={16} /></span><strong>{listing.quantity} <small>{listing.unit}</small></strong><span>available</span></div><div className="deadline-fact"><span className="fact-icon"><Clock3 size={15} /></span><strong>{remaining < 24 ? `${remaining}h left` : formatDate(listing.pickupEnd, false)}</strong><span>pickup by</span></div></div><div className="listing-location"><MapPin size={14} /><span>{listing.pickupLocation}</span></div><div className="handling-snippet"><span className="handling-line" /><span>{listing.handling}</span></div><div className="card-footer"><button className="button button-primary request-button" onClick={onRequest}><HeartHandshake size={15} />Request pickup</button><button className="button button-quiet detail-button" onClick={onSelect}>Details <ArrowRight size={14} /></button></div></div></article>;
}

function ListingDetail({ listing, onClose, onRequest, onReport }: { listing: Listing; onClose: () => void; onRequest: () => void; onReport: () => void }) {
  return <Modal onClose={onClose}><div className="detail-modal"><div className={`food-art detail-art food-art-${listing.category === 'Bakery' ? 'bakery' : listing.category === 'Produce' ? 'produce' : listing.category === 'Prepared meals' ? 'meal' : 'other'}`}><span className="food-art-symbol">{listing.category === 'Bakery' ? '✳' : listing.category === 'Produce' ? '◉' : '◒'}</span><span className="food-art-category">{listing.category}</span><button className="modal-close detail-close" aria-label="Close" onClick={onClose}><X size={18} /></button></div><div className="detail-content"><p className="eyebrow">OFFERED BY {listing.donorOrganization.toUpperCase()}</p><h2>{listing.name}</h2><p className="detail-description">{listing.description}</p><div className="detail-highlight"><span><PackageCheck size={17} /><strong>{listing.quantity} {listing.unit}</strong> available</span><span><Clock3 size={17} /><strong>Pickup by</strong> {formatDate(listing.pickupEnd)}</span></div><div className="detail-info-grid"><div><span className="detail-label">PICKUP WINDOW</span><strong>{formatDate(listing.pickupStart)} – {formatDate(listing.pickupEnd)}</strong></div><div><span className="detail-label">PICKUP LOCATION</span><strong><MapPin size={15} />{listing.pickupLocation}</strong></div><div><span className="detail-label">USE-BY GUIDANCE</span><strong>{listing.useBy ? formatDate(listing.useBy) : 'Not provided'}</strong></div><div><span className="detail-label">PREPARED</span><strong>{formatDate(listing.preparedAt)}</strong></div></div><div className="safety-detail"><ShieldAlert size={17} /><div><strong>Handling & allergens</strong><p>{listing.handling}</p><p>Allergens: {listing.allergens || 'Not specified by donor'}</p></div></div><div className="detail-actions"><button className="button button-primary" onClick={onRequest}><HeartHandshake size={16} />Request this food</button><button className="button button-quiet" onClick={onReport}><ShieldAlert size={15} />Report listing</button></div><p className="detail-disclaimer">The donor provides all food and handling information. Harvest Share does not inspect or certify food as safe.</p></div></div></Modal>;
}

function DonorListings({ listings, onCreate, onEdit, onRemove, onRequests }: { listings: Listing[]; onCreate: () => void; onEdit: (listing: Listing) => void; onRemove: (listing: Listing) => void; onRequests: () => void }) {
  const [filter, setFilter] = useState('all');
  const filtered = listings.filter((listing) => filter === 'all' || listing.status === filter);
  return <section className="donor-listings"><div className="filter-row"><div className="filter-tabs">{['all', 'available', 'requested', 'reserved', 'picked_up', 'completed', 'removed', 'expired'].map((status) => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)}>{status === 'all' ? 'All listings' : statusLabel(status)}</button>)}</div><span className="result-count">{filtered.length} listings</span></div>{filtered.length ? <div className="donor-list-grid">{filtered.map((listing) => <article className="donor-list-item" key={listing.id}><div className="donor-list-icon"><Utensils size={18} /></div><div className="donor-list-main"><div className="donor-list-title"><h3>{listing.name}</h3><StatusBadge status={listing.status} /></div><p>{listing.quantity} {listing.unit} <span>·</span> {listing.category} <span>·</span> Pickup by {formatDate(listing.pickupEnd)}</p><small><MapPin size={13} />{listing.pickupLocation}</small></div><div className="donor-list-actions">{listing.requestCount > 0 && <button className="text-button" title="View incoming requests" onClick={onRequests}>{listing.requestCount} pending <ArrowRight size={14} /></button>}{listing.status === 'available' && <button className="icon-button" title="Edit listing" aria-label="Edit listing" onClick={() => onEdit(listing)}><SlidersHorizontal size={16} /></button>}{['available', 'requested'].includes(listing.status) && <button className="icon-button danger-hover" title="Remove listing" aria-label="Remove listing" onClick={() => onRemove(listing)}><Trash2 size={16} /></button>}</div></article>)}</div> : <EmptyState icon={Store} title="No listings in this view" body="Share surplus food to help it find a good home." action={<button className="button button-primary" onClick={onCreate}><Plus size={16} />Share food</button>} />}</section>;
}

function RequestsList({ requests, user, onAction, onConfirm }: { requests: DonationRequest[]; user: User; onAction: (request: DonationRequest, action: string) => void; onConfirm: (request: DonationRequest, action: 'pickup' | 'complete') => void }) {
  if (!requests.length) return <EmptyState icon={HeartHandshake} title="No requests here yet" body="When there’s an update, you’ll find it here. A clear handoff starts with good communication." />;
  return <div className="request-list">{requests.map((request) => <article className="request-card" key={request.id}><div className="request-card-main"><div className="request-product-icon"><Utensils size={18} /></div><div className="request-copy"><div className="request-title-row"><h3>{request.listingName}</h3><StatusBadge status={request.status} /></div><p>{user.role === 'donor' ? <><strong>{request.recipientOrganization}</strong> requested {request.quantity} {request.unit}</> : <><strong>{request.donorOrganization}</strong> · {request.quantity} {request.unit}</>}</p><div className="request-meta"><span><MapPin size={14} />{request.pickupLocation}</span><span><Clock3 size={14} />Pickup {formatDate(request.pickupStart)}–{formatDate(request.pickupEnd)}</span></div>{request.status === 'accepted' && <div className="handoff-note"><CheckCircle2 size={15} /><span>{user.role === 'recipient' ? `Pickup confirmed with ${request.donorOrganization}. Contact ${request.donorName} at ${request.donorPhone}.` : `Accepted for ${request.recipientOrganization}. Contact ${request.recipientName} at ${request.recipientPhone}.`}</span></div>}{request.status === 'picked_up' && <div className="handoff-note"><PackageCheck size={15} /><span>Pickup confirmed. Waiting for the donor to confirm completion.</span></div>}</div></div><div className="request-actions">
    {user.role === 'donor' && request.status === 'pending' && <><button className="button button-primary compact-button" onClick={() => onAction(request, 'accept')}><Check size={15} />Accept</button><button className="button button-outline compact-button" onClick={() => onAction(request, 'reject')}>Decline</button></>}
    {user.role === 'recipient' && request.status === 'pending' && <button className="button button-outline compact-button" onClick={() => onAction(request, 'cancel')}>Cancel request</button>}
    {user.role === 'recipient' && request.status === 'accepted' && <button className="button button-primary compact-button" onClick={() => onConfirm(request, 'pickup')}><PackageCheck size={15} />Confirm pickup</button>}
    {user.role === 'donor' && request.status === 'picked_up' && <button className="button button-primary compact-button" onClick={() => onConfirm(request, 'complete')}><CheckCircle2 size={15} />Confirm complete</button>}
    {user.role === 'recipient' && request.status === 'accepted' && <button className="button button-outline compact-button" onClick={() => onAction(request, 'cancel')}>Cancel pickup</button>}
  </div></article>)}</div>;
}

function StatusBadge({ status }: { status: string }) { return <span className={`status-badge status-${status}`}>{statusLabel(status)}</span>; }

function ReportsList({ reports, onReview }: { reports: Report[]; onReview: (report: Report) => void }) {
  if (!reports.length) return <EmptyState icon={BadgeCheck} title="All clear" body="There are no reports to review right now." />;
  return <div className="report-list">{reports.map((report) => <article className="report-row" key={report.id}><span className={`report-icon ${report.status}`}><ShieldAlert size={17} /></span><div className="report-copy"><div><strong>{report.listing_name}</strong><StatusBadge status={report.status} /></div><p>{report.reason} · Reported by {report.reporter_organization}</p><small>{report.details}</small></div><span className="report-date">{formatDate(report.created_at, false)}</span>{report.status === 'open' && <button className="button button-outline compact-button" onClick={() => onReview(report)}>Review <ArrowRight size={14} /></button>}</article>)}</div>;
}

function ProfilePanel({ user, onEdit, onSignOut }: { user: User; onEdit: () => void; onSignOut: () => void }) {
  return <section className="profile-view"><div className="profile-banner"><span className="profile-avatar"><Store size={27} /></span><div><p className="eyebrow">{user.role.toUpperCase()} ORGANIZATION</p><h2>{user.organization}</h2><p>{user.name} · Member since this demo began</p></div><button className="button button-outline" onClick={onEdit}><SlidersHorizontal size={15} />Edit profile</button></div><div className="profile-details"><div><span>CONTACT PERSON</span><strong>{user.name}</strong></div><div><span>EMAIL ADDRESS</span><strong>{user.email}</strong></div><div><span>PHONE</span><strong>{user.phone}</strong></div><div><span>ADDRESS</span><strong>{user.address}</strong></div>{user.role === 'recipient' && <div><span>SERVICE AREA</span><strong>{user.serviceArea || 'Add your service area'}</strong></div>}</div><div className="profile-note"><ShieldAlert size={17} /><div><strong>Keep pickup details current</strong><p>Accurate contact and location information helps every handoff run smoothly. Use fictional contact information for this demo.</p></div></div><button className="button button-outline signout-button" onClick={onSignOut}><ArrowLeft size={15} />Sign out</button></section>;
}

function SafetyPage() {
  return <section className="safety-page"><div className="safety-hero"><span><ShieldAlert size={21} /></span><p className="eyebrow">A SHARED RESPONSIBILITY</p><h2>Care is part of every handoff.</h2><p>Harvest Share helps coordinate food donations. We do not inspect, test, or certify donated food as safe.</p></div><div className="safety-guidelines"><article><span>01</span><div><h3>Donors: share clear details</h3><p>Provide accurate preparation times, pickup windows, use-by guidance, storage and handling notes, and known allergen information. Keep food information up to date.</p></div></article><article><span>02</span><div><h3>Recipients: review before pickup</h3><p>Check the quantity, pickup window, donor-provided handling information, and allergen notes. Contact the donor with questions before accepting a donation.</p></div></article><article><span>03</span><div><h3>Everyone: follow local rules</h3><p>All parties are responsible for following applicable local food-safety laws and guidance. Do not rely on this platform to determine whether food is safe to consume.</p></div></article><article><span>04</span><div><h3>Use fictional demo details</h3><p>This hackathon demo uses fictional names, addresses, and phone numbers. Do not enter real personal data while evaluating it.</p></div></article></div></section>;
}

function ListingForm({ listing, busy, onCancel, onSubmit }: { listing?: Listing; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ name: listing?.name || '', description: listing?.description || '', category: listing?.category || 'Prepared meals', quantity: String(listing?.quantity || ''), unit: listing?.unit || 'portions', preparedAt: localInput(listing?.preparedAt || new Date().toISOString()), pickupLocation: listing?.pickupLocation || '', pickupStart: localInput(listing?.pickupStart), pickupEnd: localInput(listing?.pickupEnd || new Date(Date.now() + 5 * 3600000).toISOString()), useBy: listing?.useBy ? localInput(listing.useBy) : '', handling: listing?.handling || '', allergens: listing?.allergens || '' });
  const [formError, setFormError] = useState('');
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault(); setFormError('');
    if (Number(form.quantity) <= 0 || !Number.isFinite(Number(form.quantity))) { setFormError('Quantity must be greater than zero.'); return; }
    if (new Date(form.pickupStart) <= new Date() || new Date(form.pickupEnd) <= new Date(form.pickupStart)) { setFormError('Choose a future pickup window with an end time after the start.'); return; }
    onSubmit({ ...form, quantity: Number(form.quantity), preparedAt: new Date(form.preparedAt).toISOString(), pickupStart: new Date(form.pickupStart).toISOString(), pickupEnd: new Date(form.pickupEnd).toISOString(), useBy: form.useBy ? new Date(form.useBy).toISOString() : '' });
  };
  return <div className="form-modal"><div className="modal-heading"><span className="modal-icon"><Utensils size={18} /></span><div><p className="eyebrow">DONATION DETAILS</p><h2>{listing ? 'Update your listing' : 'Share surplus food'}</h2><p>Clear information helps organizations plan a smooth pickup.</p></div><button className="modal-close" aria-label="Close" onClick={onCancel}><X size={18} /></button></div>{formError && <div className="alert alert-error"><AlertCircle size={16} />{formError}</div>}<form className="modal-form" onSubmit={submit}><label>Food name<input required minLength={2} maxLength={100} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Vegetable grain bowls" /></label><label>Description<textarea required minLength={8} maxLength={700} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="What is included? How is it packed?" rows={3} /></label><div className="form-grid"><label>Category<select value={form.category} onChange={(event) => update('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="inline-fields"><label>Quantity<input required type="number" min="0.1" max="10000" step="0.1" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} placeholder="12" /></label><label>Unit<input required maxLength={30} value={form.unit} onChange={(event) => update('unit', event.target.value)} placeholder="portions" /></label></div></div><div className="form-grid"><label>Prepared at<input required type="datetime-local" value={form.preparedAt} onChange={(event) => update('preparedAt', event.target.value)} /></label><label>Pickup location<input required maxLength={180} value={form.pickupLocation} onChange={(event) => update('pickupLocation', event.target.value)} placeholder="18 Orchard Row, Brookhaven" /></label></div><div className="form-grid"><label>Pickup starts<input required type="datetime-local" value={form.pickupStart} onChange={(event) => update('pickupStart', event.target.value)} /></label><label>Pickup ends<input required type="datetime-local" value={form.pickupEnd} onChange={(event) => update('pickupEnd', event.target.value)} /></label></div><label>Use-by guidance <span className="optional">(optional)</span><input type="datetime-local" value={form.useBy} onChange={(event) => update('useBy', event.target.value)} /></label><label>Handling and storage<input required minLength={8} maxLength={500} value={form.handling} onChange={(event) => update('handling', event.target.value)} placeholder="How was it stored? What should recipients know?" /></label><label>Allergen information<input maxLength={200} value={form.allergens} onChange={(event) => update('allergens', event.target.value)} placeholder="Known allergens, or 'None declared'" /></label><div className="form-reminder"><ShieldAlert size={16} /><span>Provide accurate information and follow applicable local food-safety rules. Harvest Share does not certify food.</span></div><div className="modal-actions"><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : listing ? 'Save changes' : 'Publish listing'}<ArrowRight size={16} /></button></div></form></div>;
}

function ReportForm({ listing, busy, onCancel, onSubmit }: { listing: Listing; busy: boolean; onCancel: () => void; onSubmit: (data: { reason: string; details: string }) => void }) {
  const [reason, setReason] = useState('Inaccurate details');
  const [details, setDetails] = useState('');
  return <div className="form-modal"><div className="modal-heading"><span className="modal-icon alert-icon"><ShieldAlert size={18} /></span><div><p className="eyebrow">COMMUNITY REVIEW</p><h2>Report this listing</h2><p>{listing.name}</p></div><button className="modal-close" aria-label="Close" onClick={onCancel}><X size={18} /></button></div><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ reason, details }); }}><label>What’s the concern?<select value={reason} onChange={(event) => setReason(event.target.value)}><option>Inaccurate details</option><option>Food-safety concern</option><option>Inappropriate content</option><option>Other</option></select></label><label>Share a few details<textarea required minLength={8} maxLength={500} rows={4} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Please describe what needs review." /></label><div className="form-reminder"><ShieldAlert size={16} /><span>Reports go to the platform admin for review. The platform does not determine food safety.</span></div><div className="modal-actions"><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Sending…' : 'Send report'}<ArrowRight size={16} /></button></div></form></div>;
}

function ProfileForm({ user, busy, onCancel, onSubmit }: { user: User; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, string>) => void }) {
  const [form, setForm] = useState({ name: user.name, organization: user.organization, phone: user.phone, address: user.address, serviceArea: user.serviceArea });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="form-modal"><div className="modal-heading"><span className="modal-icon"><BadgeCheck size={18} /></span><div><p className="eyebrow">ORGANIZATION PROFILE</p><h2>Keep details current</h2><p>These details are shared to coordinate pickups.</p></div><button className="modal-close" aria-label="Close" onClick={onCancel}><X size={18} /></button></div><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><label>Contact name<input required minLength={2} maxLength={80} value={form.name} onChange={(event) => update('name', event.target.value)} /></label><label>Organization name<input required minLength={2} maxLength={120} value={form.organization} onChange={(event) => update('organization', event.target.value)} /></label><label>Phone<input required minLength={7} maxLength={40} value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label><label>Address<input required minLength={5} maxLength={180} value={form.address} onChange={(event) => update('address', event.target.value)} /></label>{user.role === 'recipient' && <label>Service area<input maxLength={180} value={form.serviceArea} onChange={(event) => update('serviceArea', event.target.value)} placeholder="Northside, Central" /></label>}<div className="modal-actions"><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}<Check size={16} /></button></div></form></div>;
}

function ConfirmAction({ request, action, busy, onCancel, onConfirm }: { request: DonationRequest; action: 'pickup' | 'complete'; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="confirm-modal"><span className="confirm-icon"><PackageCheck size={24} /></span><p className="eyebrow">PICKUP CONFIRMATION</p><h2>{action === 'pickup' ? 'Confirm you collected this donation?' : 'Confirm this donation is complete?'}</h2><p>{action === 'pickup' ? <>You’re confirming pickup of <strong>{request.listingName}</strong> from {request.donorOrganization}. Please verify the food and handoff details directly with the donor.</> : <>You’re confirming the handoff of <strong>{request.listingName}</strong> to {request.recipientOrganization} is complete.</>}</p><div className="confirm-detail"><MapPin size={15} /><span>{request.pickupLocation}</span><span className="confirm-dot">·</span><Clock3 size={15} /><span>{formatDate(request.pickupStart)}</span></div><div className="confirm-actions"><button className="button button-outline" onClick={onCancel}>Go back</button><button className="button button-primary" disabled={busy} onClick={onConfirm}><CheckCircle2 size={16} />{busy ? 'Confirming…' : action === 'pickup' ? 'Yes, pickup confirmed' : 'Yes, mark complete'}</button></div><small>This action records your confirmation and the current time.</small></div>;
}

function AdminReview({ report, busy, onCancel, onSubmit }: { report: Report; busy: boolean; onCancel: () => void; onSubmit: (action: 'dismiss' | 'remove', note: string) => void }) {
  const [note, setNote] = useState('');
  const [action, setAction] = useState<'dismiss' | 'remove'>('dismiss');
  return <div className="form-modal"><div className="modal-heading"><span className="modal-icon alert-icon"><ShieldAlert size={18} /></span><div><p className="eyebrow">REPORT #{report.id}</p><h2>Review listing report</h2><p>{report.listing_name} · {report.reporter_organization}</p></div><button className="modal-close" aria-label="Close" onClick={onCancel}><X size={18} /></button></div><div className="report-detail"><span className="detail-label">REASON</span><strong>{report.reason}</strong><span className="detail-label">DETAILS</span><p>{report.details}</p><span className="detail-label">REPORTED</span><strong>{formatDate(report.created_at)}</strong></div><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(action, note); }}><label>Admin note <span className="optional">(optional)</span><textarea rows={3} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the reason for this decision." /></label><div className="review-choice"><button type="button" className={action === 'dismiss' ? 'selected' : ''} onClick={() => setAction('dismiss')}><Check size={16} /><span><strong>Dismiss report</strong><small>Keep the listing available</small></span></button><button type="button" className={action === 'remove' ? 'selected remove-choice' : 'remove-choice'} onClick={() => setAction('remove')}><Trash2 size={16} /><span><strong>Remove listing</strong><small>Make it unavailable</small></span></button></div><div className="modal-actions"><button className="button button-outline" type="button" onClick={onCancel}>Cancel</button><button className={`button ${action === 'remove' ? 'button-danger' : 'button-primary'}`} disabled={busy}>{busy ? 'Recording…' : action === 'remove' ? 'Remove listing' : 'Dismiss report'}<ArrowRight size={16} /></button></div></form></div>;
}

function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Search; title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-window" role="dialog" aria-modal="true">{children}</div></div>;
}

export default App;
