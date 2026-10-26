import { randomUUID } from 'node:crypto'
import type { BatchItemState, BatchRequest, BatchState } from '../shared/types.js'
import { ApiError } from './errors.js'
import type { NarrationService } from './narration.js'

interface Job {
  id: string
  req: BatchRequest
  /** Page text is held in memory only while the job runs, then dropped. */
  texts: Map<string, string>
  items: BatchItemState[]
  status: BatchState['status']
  message?: string
  cancelled: boolean
  createdAt: number
}

/** In-memory background batch runner with bounded concurrency, cancellation and retry. */
export class JobManager {
  private jobs = new Map<string, Job>()

  constructor(
    private narration: NarrationService,
    private concurrency = 2,
  ) {}

  create(req: BatchRequest): string {
    this.prune()
    const job: Job = {
      id: randomUUID(),
      req,
      texts: new Map(req.items.map((i) => [i.key, i.text])),
      items: req.items.map((i) => ({ key: i.key, status: 'queued' })),
      status: 'running',
      cancelled: false,
      createdAt: Date.now(),
    }
    this.jobs.set(job.id, job)
    void this.drive(job)
    return job.id
  }

  get(id: string): BatchState | undefined {
    const j = this.jobs.get(id)
    return j && { id: j.id, status: j.status, items: j.items, message: j.message }
  }

  cancel(id: string): BatchState | undefined {
    const j = this.jobs.get(id)
    if (!j) return undefined
    j.cancelled = true
    for (const it of j.items) if (it.status === 'queued') it.status = 'cancelled'
    this.settle(j)
    return this.get(id)
  }

  /** Re-queue failed/cancelled items and resume. */
  retry(id: string): BatchState | undefined {
    const j = this.jobs.get(id)
    if (!j) return undefined
    if (j.status === 'running') return this.get(id)
    for (const it of j.items) if (it.status === 'error' || it.status === 'cancelled') (it.status = 'queued'), (it.error = undefined)
    j.cancelled = false
    j.status = 'running'
    j.message = undefined
    void this.drive(j)
    return this.get(id)
  }

  private async drive(job: Job) {
    const worker = async () => {
      for (;;) {
        if (job.cancelled || job.status === 'failed') return
        const item = job.items.find((i) => i.status === 'queued')
        if (!item) return
        item.status = 'generating'
        try {
          const text = job.texts.get(item.key) ?? ''
          const res = await this.narration.generate(text, job.req.voiceId, job.req.settings)
          item.status = 'done'
          item.narrationId = res.id
          item.format = res.format
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError('internal', 'Unexpected error')
          item.status = 'error'
          item.error = { code: err.code, message: err.message }
          // Quota/auth problems will fail every remaining item: stop instead of burning requests.
          if (err.code === 'quota_exceeded' || err.code === 'not_configured') {
            job.status = 'failed'
            job.message = err.message
            for (const it of job.items) if (it.status === 'queued') it.status = 'cancelled'
          }
          if (err.code === 'rate_limited') await new Promise((r) => setTimeout(r, (err.retryAfter ?? 5) * 1000))
        }
      }
    }
    await Promise.all(Array.from({ length: this.concurrency }, worker))
    this.settle(job)
  }

  private settle(job: Job) {
    if (job.items.some((i) => i.status === 'generating')) return
    if (job.status === 'failed') return
    job.status = job.cancelled ? 'cancelled' : 'done'
  }

  private prune() {
    const cutoff = Date.now() - 6 * 3600_000
    for (const [id, j] of this.jobs) if (j.createdAt < cutoff && j.status !== 'running') this.jobs.delete(id)
  }
}
