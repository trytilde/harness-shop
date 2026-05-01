import { getDb, schema } from '#/server/db/client'
import type { StoredPart } from '#/server/api/chat-history'

/**
 * Server-only writer kept out of `chat-history.ts` (which exports a server
 * function the client imports). Co-locating it with the server-fn caused the
 * client bundle to drag node:fs through the dependency graph.
 */
export async function persistChatMessage(args: {
  experimentId: string
  id: string
  role: 'user' | 'assistant'
  parts: StoredPart[]
}) {
  if (args.parts.length === 0) return
  const db = await getDb()
  await db
    .insert(schema.chatMessages)
    .values({
      id: args.id,
      experimentId: args.experimentId,
      role: args.role,
      partsJson: JSON.stringify(args.parts),
      createdAt: new Date(),
    })
    .onConflictDoNothing()
}
