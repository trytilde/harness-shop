import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getDb, schema } from '#/server/db/client'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue }

export type StoredPart =
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool'
      toolCallId: string
      toolName: string
      state: 'input-available' | 'output-available' | 'output-error'
      input?: JsonValue
      output?: JsonValue
      errorText?: string
    }

export type StoredMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: StoredPart[]
}

const idSchema = z.object({ experimentId: z.string().min(1) })

export const getChatHistoryFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await getDb()
    const rows = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.experimentId, data.experimentId))
      .orderBy(asc(schema.chatMessages.createdAt))
    const result: StoredMessage[] = rows.map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      parts: JSON.parse(r.partsJson) as StoredPart[],
    }))
    return result
  })

