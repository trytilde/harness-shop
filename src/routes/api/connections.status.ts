import { createFileRoute } from '@tanstack/react-router'

import { readConnectionStatuses } from '#/server/api/connection-status'

export const Route = createFileRoute('/api/connections/status')({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await readConnectionStatuses())
        } catch (e) {
          return Response.json(
            { error: (e as Error).message },
            { status: 500 },
          )
        }
      },
    },
  },
})
