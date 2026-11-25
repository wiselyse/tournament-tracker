import { Link, NavLink, Outlet, useParams } from 'react-router'
import { TournamentProvider, useT, useTournamentQuery } from '../state/tournament'
import { statusChip } from '../state/describe'
import { useTheme } from '../theme/useTheme'
import { Icon } from './Icon'
import { Toast } from './Toast'

const NAV = [
  { to: 'live', label: 'Live', icon: 'live' },
  { to: 'players', label: 'Players', icon: 'players' },
  { to: 'bracket', label: 'Bracket', icon: 'bracket' },
  { to: 'timeline', label: 'Timeline', icon: 'timeline' },
  { to: 'report', label: 'Report', icon: 'report' },
  { to: 'export', label: 'Export', icon: 'export' },
]

export function Mark() {
  return (
    <Link to="/" className="rail-mark" aria-label="All tournaments">
      <img src="/brand/wsf-logo.png" alt="" width={48} height={48} />
    </Link>
  )
}

export function ThemeButton() {
  const [theme, toggle] = useTheme()
  return (
    <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
    </button>
  )
}

/** Layout for every /t/:id/* screen: rail, top bar, tab bar (portrait), toast. */
export function TournamentShell() {
  const { id = '' } = useParams()
  const q = useTournamentQuery(id)
  if (q.isPending) return <div className="center-msg">Loading…</div>
  if (q.isError)
    return (
      <div className="center-msg">
        <p>{q.error.message}</p>
        <Link className="btn btn-primary" to="/">All tournaments</Link>
      </div>
    )
  return (
    <TournamentProvider state={q.data}>
      <Frame />
    </TournamentProvider>
  )
}

function Frame() {
  const { state, undo, redo, pending } = useT()
  const chip = statusChip(state)
  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <Mark />
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="rail-item">
            <Icon name={n.icon} size={22} />
            {n.label}
          </NavLink>
        ))}
        <div className="grow" />
        <NavLink to="/settings" className="rail-item">
          <Icon name="settings" size={22} />
          Settings
        </NavLink>
      </nav>
      <div className="main-col">
        <header className="topbar">
          <Link to="/" className="topbar-title">{state.tournament.name}</Link>
          <span className="chip">{chip.text}</span>
          {chip.next && <span className="chip chip-quiet hide-narrow">{chip.next}</span>}
          <div className="grow" />
          {pending && <span className="busy-dot" role="status" aria-label="Saving" />}
          <button className="icon-btn" onClick={undo} disabled={!state.can_undo || pending} aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!state.can_redo || pending} aria-label="Redo">
            <Icon name="redo" />
          </button>
          <ThemeButton />
        </header>
        <Outlet />
      </div>
      <nav className="tabbar" aria-label="Main">
        {NAV.slice(0, 4).map((n) => (
          <NavLink key={n.to} to={n.to} className="tab-item">
            <Icon name={n.icon} size={22} />
            {n.label}
          </NavLink>
        ))}
        <NavLink to="more" className="tab-item">
          <Icon name="more" size={22} />
          More
        </NavLink>
      </nav>
      <Toast />
    </div>
  )
}

export function MoreMenu() {
  return (
    <div className="page">
      <h1 className="page-title">More</h1>
      <div className="list">
        {[...NAV.slice(4), { to: '/settings', label: 'Settings', icon: 'settings' }].map((n) => (
          <Link key={n.to} to={n.to.startsWith('/') ? n.to : `../${n.to}`} relative="path" className="list-row">
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
        <Link to="/" className="list-row">
          <Icon name="back" />
          All tournaments
        </Link>
      </div>
    </div>
  )
}
