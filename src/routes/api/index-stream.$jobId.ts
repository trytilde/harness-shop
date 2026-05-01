import { createFileRoute } from '@tanstack/react-router'

import { getJob, subscribe, type IndexJobEvent } from '#/server/indexing/jobs'

export const Route = createFileRoute('/api/index-stream/$jobId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const job = getJob(params.jobId)
        if (!job) {
          return new Response('job not found', { status: 404 })
        }

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            const send = (event: IndexJobEvent) => {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                )
              } catch {
                /* controller closed */
              }
            }

            // Replay buffered events first.
            for (const ev of job.events) send(ev)

            // Stream live events.
            const unsubscribe = subscribe(job, (ev) => {
              send(ev)
              if (ev.type === 'done' || ev.type === 'error') {
                try {
                  controller.close()
                } catch {}
                unsubscribe()
              }
            })

            // If job already terminal, close immediately after replay.
            if (job.phase === 'ready' || job.phase === 'failed') {
              try {
                controller.close()
              } catch {}
              unsubscribe()
            }
          },
        })

        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          },
        })
      },
    },
  },
})
