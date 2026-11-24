import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router'
import { ConfirmProvider } from './components/Confirm'
import { Icon } from './components/Icon'
import { Mark, MoreMenu, TournamentShell } from './components/Shell'
import { Live } from './screens/live/Live'
import { Bracket } from './screens/Bracket'
import { Players } from './screens/Players'
import { Report } from './screens/Report'
import { Timeline } from './screens/Timeline'
import { Settings } from './screens/Settings'
import { SetupWizard } from './screens/SetupWizard'
import { Tournaments } from './screens/Tournaments'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 2000 } },
})

/** Pages outside a tournament: just the WSF mark and Settings in the rail. */
function HomeShell() {
  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <Mark />
        <div className="grow" />
        <Link to="/settings" className="rail-item">
          <Icon name="settings" size={22} />
          Settings
        </Link>
      </nav>
      <div className="main-col scroll">
        <Outlet />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<HomeShell />}>
              <Route index element={<Tournaments />} />
              <Route path="new" element={<SetupWizard />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="t/:id" element={<TournamentShell />}>
              <Route index element={<Navigate to="live" replace />} />
              <Route path="live" element={<Live />} />
              <Route path="players" element={<Players />} />
              <Route path="timeline" element={<Timeline />} />
              <Route path="bracket" element={<Bracket />} />
              <Route path="report" element={<Report />} />
              <Route path="export" element={<Report />} />
              <Route path="more" element={<MoreMenu />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  )
}
