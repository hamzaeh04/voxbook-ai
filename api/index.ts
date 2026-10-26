/**
 * Vercel serverless entry: the same Express app as `npm run dev`, exported as the request handler.
 * vercel.json rewrites every /api/* request here.
 */
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'

const { app } = createApp(loadConfig())

export default app
