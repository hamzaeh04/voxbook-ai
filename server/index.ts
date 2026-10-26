import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { createApp } from './app'
import { loadConfig } from './config'

const cfg = loadConfig()
const { app, cache, provider } = createApp(cfg)

if (cfg.production && existsSync('dist')) {
  app.use(express.static('dist'))
  app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')))
}

await cache.init()
const removed = await cache.purge(cfg.retentionHours)
setInterval(() => void cache.purge(cfg.retentionHours), 3600_000).unref()

app.listen(cfg.port, () => {
  console.log(`VoxBook API on http://localhost:${cfg.port}`)
  console.log(`  TTS provider: ${provider.info.label} (${provider.info.configured ? 'configured' : 'NOT configured'})`)
  if (provider.info.isMock) console.warn('  ⚠ MOCK provider active — audio is synthetic tones, not speech.')
  if (!provider.info.configured && provider.info.setupHint) console.warn(`  ⚠ ${provider.info.setupHint}`)
  if (removed) console.log(`  Purged ${removed} expired cached audio files.`)
})
