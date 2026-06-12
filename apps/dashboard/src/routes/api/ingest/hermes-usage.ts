import { createFileRoute } from '@tanstack/react-router'

import { ingestExternalRollupsToD1 } from '#/lib/openai-usage'
import type { ExternalIngestPayload } from '#/lib/openai-usage'
import { getRuntimeEnv } from '#/lib/worker-env'

export const Route = createFileRoute('/api/ingest/hermes-usage')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = getRuntimeEnv()
        const expectedToken = env.HERMES_TOKEN_ANALYTICS_SHARED_SECRET || env.INGEST_SHARED_SECRET

        if (!expectedToken) {
          return Response.json(
            {
              error:
                'HERMES_TOKEN_ANALYTICS_SHARED_SECRET is not configured in the Worker runtime. Legacy INGEST_SHARED_SECRET is still accepted.',
            },
            { status: 503 },
          )
        }

        const authHeader = request.headers.get('authorization') || ''
        const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

        if (!providedToken || providedToken !== expectedToken) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const payload: ExternalIngestPayload = await request.json()
          const result = await ingestExternalRollupsToD1(env, payload)
          return Response.json(result, { status: 200 })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return Response.json({ error: message }, { status: 400 })
        }
      },
    },
  },
})
