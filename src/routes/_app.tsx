import { Outlet, createFileRoute } from '@tanstack/react-router'

import { TopBar } from '#/components/top-bar'

export const Route = createFileRoute('/_app')({ component: AppLayout })

function AppLayout() {
  return (
    <div className="bg-background flex min-h-svh flex-col">
      <TopBar />
      <main className="flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
