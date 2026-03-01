import { Navigate, Outlet } from 'react-router-dom'
import { useCurrentUser } from '../../api/auth'
import { FullScreenSpinner } from '../ui/Spinner'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export default function AppLayout() {
  const { data: user, isLoading, isError } = useCurrentUser()

  if (isLoading) return <FullScreenSpinner />
  if (isError || !user) return <Navigate to="/login" replace />

  return (
    <div className="flex h-full bg-bg-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
