import { createFileRoute } from '@tanstack/react-router'

import { cancelStream } from '#/server/chat/active-streams'

/**
 * Aborts the in-flight agent turn for the given experiment, if any.
 *
 * The Stop button in the chat UI hits this. Refreshing the page or closing
 * the tab does NOT — that just drops a subscriber.
 */
export const Route = createFileRoute(
  '/api/experiments/$experimentId/chat/cancel',
)({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const ok = cancelStream(params.experimentId)
        return new Response(JSON.stringify({ ok }), {
          status: ok ? 200 : 404,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
