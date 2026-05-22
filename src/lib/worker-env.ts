import { env as workerEnv } from 'cloudflare:workers'

import type { CloudflareAppEnv } from '#/lib/runtime'

export function getRuntimeEnv(): CloudflareAppEnv {
  return workerEnv as unknown as CloudflareAppEnv
}
