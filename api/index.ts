/**
 * Vercel serverless entry: the same Express app as `npm run dev`, exported as the request handler.
 * vercel.json rewrites every /api/* request here.
 */
import { createApp } from '../server/app'
import { loadConfig } from '../server/config'

const { app } = createApp(loadConfig())

export default app
