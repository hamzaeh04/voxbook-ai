import { PlugZap } from 'lucide-react'
import { useVoices } from '@/stores/voices'
import { Button } from '../ui/Button'
import { Notice } from '../ui/misc'

/** Clearly labelled provider status: setup needed, server unreachable, or mock provider active. */
export function SetupBanner() {
  const { provider, status, error, load } = useVoices()
  if (status === 'error') {
    return (
      <Notice tone="error" title="Narration server unreachable" action={<Button size="sm" onClick={() => void load()}>Retry</Button>}>
        {error} Reading and your library still work offline.{' '}
        {['localhost', '127.0.0.1'].includes(location.hostname) ? (
          <>Narration needs the API server: run <code>npm run dev</code>.</>
        ) : (
          <>Narration needs the API: check the deployment’s function logs (on Vercel: Project → Logs).</>
        )}
      </Notice>
    )
  }
  if (!provider) return null
  if (!provider.configured) {
    return (
      <Notice tone="warning" title="Text-to-speech is not set up yet">
        <span className="inline-flex items-start gap-1.5"><PlugZap size={15} className="mt-0.5 shrink-0" />{provider.setupHint}</span>{' '}
        See the README’s “TTS provider setup” section. You can still upload and read books.
      </Notice>
    )
  }
  if (provider.isMock) {
    return (
      <Notice tone="warning" title="MOCK narration provider active">
        Audio is synthetic test tones, <strong>not speech</strong>. Configure OpenAI or ElevenLabs for real narration.
      </Notice>
    )
  }
  return null
}
