# VoxBook AI

*Your books. Your voice. Your world.*

A local-first reading workspace: upload a book, read it page by page, generate real cloud text-to-speech narration **for each individual page**, listen with a full audio player, save/download every page's audio, export a whole book as a ZIP, and pick up where you left off.

```
Upload → Process pages → Select voice → Generate narration → Listen page by page
      → Save each page's audio → Export recordings → Resume reading later
```

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev                 # web on http://localhost:5173, API on http://localhost:8787
```

With no configuration it uses the **free Microsoft Edge neural voices** (see below), so real narration works out of the box. Add an OpenAI or ElevenLabs key to `.env` (`cp .env.example .env`) to switch to a paid provider.

For tests and offline development there is also an isolated **mock provider** (synthetic tones, *not* speech):

```bash
TTS_PROVIDER=mock npm run dev
```

The UI shows an amber "MOCK narration provider active" banner whenever this is on. The mock provider is refused when `NODE_ENV=production` unless `ALLOW_MOCK_IN_PRODUCTION=true`.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + API (watch mode) |
| `npm run build` | Typecheck and build the web app into `dist/` |
| `npm start` | Production: API serves `dist/` and `/api` on one port |
| `npm test` | Vitest: document processing, navigation/playback, narration association, export, API + providers |
| `npm run typecheck` | `tsc -b` for web, server and tests |

## TTS provider setup

All provider keys live **only in the server's `.env`**. Nothing is prefixed `VITE_`, nothing secret is bundled into the browser, and API responses never include keys (covered by tests).

### Microsoft Edge neural voices — free (default when no key is set)

```env
TTS_PROVIDER=edge
```

Uses [msedge-tts](https://www.npmjs.com/package/msedge-tts), the Node port of the Python `edge-tts` library: Microsoft Edge's "Read Aloud" Azure neural voices, no API key and no payment. Output is real MP3 (24 kHz mono).

| Persona | Edge voice |
| --- | --- |
| Confident Heavy Male | `en-US-GuyNeural` |
| Warm Professional Female | `en-US-JennyNeural` |
| Neutral Narrator | `en-US-AriaNeural` |
| Additional | Every other English voice in Microsoft's live catalogue (47 in total, 14 accents: US, UK, Australia, Canada, India, Ireland, New Zealand, South Africa, Nigeria, Kenya, Tanzania, Singapore, Philippines, Hong Kong), including 5 multilingual voices |

**Emotion.** The free endpoint rejects Microsoft's real emotion styles (`<mstts:express-as>`), pauses (`<break>`), nested prosody, and more than two `<prosody>` elements per request; all of this was tested. So the default **Emotional (auto)** style uses a rule-based engine ([server/emotion.ts](server/emotion.ts)): each sentence is scored as somber, joyful, excited, questioning, fearful, angry, dialogue or heading from its punctuation and word cues, and voiced with a matching rate/pitch/volume shift. Consecutive sentences with the same mood are merged into one run, and runs are sent at most two per request, up to 6 requests in parallel, and the MP3s are joined in order. **Dramatic** uses the same engine at 1.6× intensity; **Calm** is slower and softer; **Neutral** reads flat. This is expressive prosody, not true acted emotion. The service offers 322 voices in 75 languages; only English is enabled for now (`VOICE_LANGUAGE_PREFIX` in [server/providers/edge.ts](server/providers/edge.ts)). The list is fetched live and cached for 12 h, with a built-in fallback of six voices if it can't be fetched. Voice Studio has search plus accent, gender and multilingual filters.

**Caveat:** this is an unofficial integration, not a Microsoft API. Microsoft can change or block it at any time, and page text is sent to Microsoft's servers (the consent dialog says so). If it breaks, set `OPENAI_API_KEY`/`ELEVENLABS_API_KEY`, or add a self-hosted engine (e.g. Coqui/Piper/Kokoro) as another provider.

### Kokoro: free voices that run in the browser

28 English voices from the open-source [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) model (Apache-2.0), via [kokoro-js](https://www.npmjs.com/package/kokoro-js). They appear next to the Edge voices; there is nothing to configure.

* **Runs on the visitor's device** in a Web Worker ([src/lib/kokoro/](src/lib/kokoro/)): free, private (no text leaves the browser, so no consent prompt), and it works even if the voice server is down. The model downloads once and is cached: ~310 MB using the GPU (WebGPU), or ~90 MB 8-bit for CPU.
* **Speed (measured):** on an Apple-Silicon Mac in Chrome, 65 s of narration took about 22 s to generate (~3× faster than real time). On CPU only, it was slower than real time (19 s of audio in ~30 s). Generated chapters are shared like any other narration, so each chapter is performed once.
* **Emotion:** Kokoro has no emotion tags, so the app performs each sentence with its own pace, loudness and the pause after it ([src/lib/kokoro/plan.ts](src/lib/kokoro/plan.ts)), using the same mood detection as Edge. Real pauses are something Edge's free endpoint rejects.
* **Quality varies by voice:** the model authors grade them A to F (shown on each voice card). *Heart* (A), *Bella* (A−), *Nicole* (soft/whispery), *Emma* (British) and *Fenrir*/*Michael* are the strongest.
* Pieces are kept under 280 characters because Kokoro silently truncates longer inputs. Audio is encoded to 48 kbps MP3 in the browser (lamejs, LGPL-3.0).

### OpenAI (used automatically when `OPENAI_API_KEY` is set)

```env
TTS_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_TTS_MODEL=gpt-4o-mini-tts   # supports delivery "instructions" (the style control)
```

Voice mapping (the closest *available* voices; the UI says so):

| Persona | OpenAI voice |
| --- | --- |
| Confident Heavy Male | `onyx` (OpenAI's deepest male voice) |
| Warm Professional Female | `nova` |
| Neutral Narrator | `alloy` |
| Additional | `ash, ballad, coral, echo, fable, sage, shimmer, verse` |

To change a mapping, edit the catalog at the top of [server/providers/openai.ts](server/providers/openai.ts).

### ElevenLabs

```env
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_MALE_ID=...      # pick a deep male voice from your library
ELEVENLABS_VOICE_FEMALE_ID=...    # a mature, warm female voice
ELEVENLABS_VOICE_NEUTRAL_ID=...
```

Your whole account voice list is shown in Voice Studio. Only the three IDs above get the "Heavy Male / Warm Female / Neutral" labels; a voice is never labelled that way just because of a metadata tag.

### Adding another provider

Implement the `TtsProvider` interface in [server/providers/types.ts](server/providers/types.ts) (`info`, `fingerprint`, `listVoices`, `synthesize`), then register it in [server/providers/index.ts](server/providers/index.ts). The client needs no changes: voices, supported settings (`style`/`pitch`/`speed`), audio format and the privacy note are all discovered from `GET /api/voices`.

### Settings honesty

| Control | Behaviour |
| --- | --- |
| Voice, style | Changes the generated audio (part of the dedupe key). Existing pages are flagged **Outdated** until regenerated. |
| Speed, volume | Applied at playback (`playbackRate` with pitch preserved); never costs a regeneration. |
| Pitch | Shown disabled: no supported provider exposes it. |

## How it works

```
src/                      React + Vite + TypeScript + Tailwind
  lib/documents/          validate, pdf (pdf.js), epub (epub.js), docx (Mammoth), txt, paginate, ocr (Tesseract)
  lib/db.ts               IndexedDB (idb): books, pages, narrations, recordings, history, files, meta
  lib/narration.ts        serial, de-duplicating, abortable generation queue; stores audio per page
  lib/batch.ts            client for server batch jobs; resumable
  lib/playback.ts         playback controller (token-guarded; continuous mode; wrong-page protection)
  lib/audioEngine.ts      one <audio> + Web Audio AnalyserNode (feeds waveform + orb)
  lib/export.ts           per-page + ZIP export (JSZip)
  components/audio/       Waveform, VoiceOrb, PlayerBar, VoiceCard
  components/books/       BookCard (3D), BookOpenOverlay, upload UI, OCR control
  pages/                  Dashboard, Library, Reader, Voice Studio, Recordings, Bookmarks, History, Settings
server/                   Express API
  providers/              edge (free), openai, elevenlabs, mock, none
  narration.ts            chunking, dedupe (sha256 key), in-flight de-duplication, disk cache
  jobs.ts                 background batch jobs: concurrency 2, cancel, retry, stop-on-quota
shared/                   types shared by client and server
```

### Data model (IndexedDB)

* **Book**: `id, title, author, format, cover, totalPages, createdAt, lastOpenedAt, lastReadPage, readingProgress`, plus `completedPages`, per-book `preferredVoiceId / playbackSpeed / continuous`, `scannedPages`.
* **Page**: `id (bookId:n), bookId, pageNumber, extractedText, bookmarked, narrationStatus`.
* **Narration**: **one asset per page** (`id = pageId`): `voiceId, voiceSettings, audioBlob, audioFormat, duration, createdAt, status, textHash`. The audio is stored under the page that was *requested*, never "whatever is on screen" when the response arrives.
* **MicRecording**, **HistoryEntry**, original PDFs (kept only while OCR is still possible).

### Pipeline guarantees

* **Association**: requests capture `(bookId, pageNumber, voice, settings, textHash)` up front; responses are written to exactly that page in a single transaction. Tested with out-of-order responses.
* **No duplicate billing**: identical `(provider+model, voice, style, text)` hash to the same server cache entry, concurrent duplicates share one upstream call (client queue *and* server), and existing audio is reused unless text/voice/style changed.
* **Wrong-page protection**: playback uses a monotonically increasing token; a slow response for a page you left is stored (it is still valid) but never played. Changing page from the reader stops audio; stepping from the player bar keeps playing.
* **Real formats**: files are named from the provider's real format (`Book_Title_Page_001.mp3`, or `.wav` for the mock provider). Nothing is renamed.
* **Privacy**: books are parsed and stored in the browser. Only the text of one page is sent per request, through the server, and only after you agree in a consent dialog that names the provider and its retention note. Generated audio is cached on the server for `AUDIO_RETENTION_HOURS` (default 24) and then purged; book text is never written to disk server-side.

### API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness + provider status (never authenticated) |
| `GET /api/voices` | Provider info (external?, mock?, format, retention note, setup hint) + voices |
| `POST /api/narration/generate` | Text of one page → audio bytes (`X-Narration-Id`, `X-Audio-Format`, `X-Cache`) |
| `GET /api/narration/:id` · `/download?filename=` | Cached audio by id |
| `POST /api/narration/batch` | Start a background job (≤ 1000 pages) |
| `GET /api/narration/batch/:id` · `POST …/cancel` · `POST …/retry` | Poll, cancel, retry failed |

Validated with zod, JSON body limit 1 MB (16 MB for batches), 60,000 chars per chapter, rate limited (`GENERATE_LIMIT_PER_MINUTE`), 60 s provider timeout, typed errors (`quota_exceeded`, `rate_limited`, `timeout`, `not_configured`, …). Batch jobs stop automatically when the quota is exhausted instead of burning requests. There are no user accounts; set `APP_ACCESS_TOKEN` to require a shared bearer token on every API call (enter it under Settings) if you expose the server beyond localhost.

The spec's `POST /api/books/process` endpoint is intentionally **not** implemented: parsing runs in the browser so private documents never leave the device.

### Production

```bash
npm run build
NODE_ENV=production PORT=8787 npm start      # serves dist/ and /api
```

Put it behind HTTPS (required for microphone access off `localhost`) and set `APP_ACCESS_TOKEN`.

### Deploying to Vercel

```bash
npx vercel login
npx vercel --prod
```

[vercel.json](vercel.json) builds the Vite app into `dist/` and serves the Express API from [api/index.ts](api/index.ts) as one serverless function (`maxDuration` 300 s). Set environment variables (e.g. `APP_ACCESS_TOKEN`, or `OPENAI_API_KEY`) under *Project → Settings → Environment Variables*. With none set, the free Edge voices are used.

On Vercel (`VERCEL=1`) the server adapts automatically:
* **No background jobs.** Serverless functions stop after responding, so "Generate all chapters" runs from the browser tab, one chapter after another. Keep the tab open; finished chapters are saved, and Resume continues later.
* **Response size limit (4.5 MB).** The browser requests long chapters in parts of about 8,000 characters and joins the MP3 parts.
* **Cache** lives in `/tmp` and is per instance and temporary, so deduplication is best-effort.
* **The mock provider** is refused in production.

**Shared library: one-time setup on Vercel.** In your Vercel project, open **Storage → Create Database → Blob**, create the store, connect it to this project (this adds `BLOB_READ_WRITE_TOKEN`), then **redeploy**. Until then the app shows "Shared library is off" and books stay in each browser.

**Public URL warning:** a Vercel deployment is reachable by anyone. Set `APP_ACCESS_TOKEN` so strangers can't use your server to generate speech. Also note that Microsoft may throttle or block the unofficial Edge endpoint from cloud IP addresses.

## Features checklist

* Upload PDF / EPUB / TXT / DOCX: drag-and-drop or picker; validation of extension, MIME, size, and file signature; per-file phase + real extraction progress; useful errors for corrupt/encrypted/empty files; editable title/author.
* **Shared library, no login.** Every uploaded book (chapter text, cover) and every generated chapter narration is stored on the server and appears for everyone who opens the app. Shared books download their text the first time they're opened in a browser, and published narration is reused instead of regenerated (no text is sent to the voice service). Rename and delete apply for everyone. Reading position, bookmarks, history and settings stay per browser. Storage is Vercel Blob in production and a local folder (`server/.data/library`) in development; see [server/library.ts](server/library.ts) and [src/lib/cloud.ts](src/lib/cloud.ts).
* **Chapter-wise reading and narration.** Each chapter is one reading unit and one audio file (`Book_Title_Chapter_001.mp3`). Chapters come from the EPUB table of contents, the PDF outline (bookmarks), or chapter headings in TXT/DOCX, and fall back to ~8,000-character parts. Title-only sections are merged into the next chapter, chapters over 60,000 characters are split into parts, and Project Gutenberg notices/licences are kept out of the story chapters. Scanned PDFs stay page-based so in-browser OCR (Tesseract; progress + cancel) can fill in their pages. Books imported before chapter support stay page-based; re-upload them to get chapters.
* Reader: serif typography, font-size / line-spacing / width controls, full screen, bookmarks, keyboard arrows, chapter number input, progress slider, page-turn transition, and an approximate paragraph highlight that scrolls along with the narration.
* Voice Studio, per-page generate / listen / regenerate / download, pause / resume / restart / stop / speed / volume / seek, single-page and continuous modes (asks before generating missing audio unless you opt in), all-pages status list.
* Batch narration for the whole book with cancel, retry-failed and resume; ZIP export (with manifest).
* Microphone recording per page (permission requested only when you press Record; never records playback).
* Library search/sort/filter, rename, delete-with-confirmation, narration progress; Saved Recordings (search, voice filter, sorting, selection, ZIP); Bookmarks; Reading History; Settings; light/dark theme.
* Accessibility: semantic landmarks, visible focus, labelled controls, live-region announcements, accessible dialogs (Radix), reduced-motion support.

### The three signature animations

1. **Waveform** ([Waveform.tsx](src/components/audio/Waveform.tsx)): canvas bars driven by `AnalyserNode.getByteFrequencyData`; settles to a calm baseline and stops its rAF loop when idle; static under reduced motion.
2. **3D book** ([BookCard.tsx](src/components/books/BookCard.tsx), [BookOpenOverlay.tsx](src/components/books/BookOpenOverlay.tsx)), Reader): spring-driven pointer tilt, cover-swing opening overlay (visual only, navigation is immediate), directional page transition. 3D is disabled on low-core/low-memory devices or when motion is reduced.
3. **Voice orb** ([VoiceOrb.tsx](src/components/audio/VoiceOrb.tsx)): idle breathing, generating pulse + sweep ring, playing scale from live amplitude (CSS variable written by rAF, no re-renders), success check, error state with `role="alert"`.

## Honest limitations

* **Verified with**: 67 unit/integration tests, live end-to-end narration with the free Edge voices (Guy and Jenny, multi-chunk pages, cache reuse), plus a real-browser run of the full workflow against the mock provider (upload of all four formats, OCR of an image-only PDF, generation, playback, seeking, continuous mode, batch, ZIP with valid WAV data, reload/resume, mic flows with a stubbed `getUserMedia`, offline/quota/consent paths). **The OpenAI and ElevenLabs adapters are tested against mocked HTTP only; they have not been exercised with live keys.** The Edge provider has been exercised live. Check the voice mapping by ear.
* No word-level timing: OpenAI and ElevenLabs (as used here) return audio only, so the highlight is an approximate paragraph position based on playback fraction and says so.
* Long pages are split at sentence boundaries, synthesized in parallel, and the returned MP3 chunks are concatenated in order; players handle this, but a seam can be faintly audible.
* Batch jobs live in server memory: a server restart loses the job (finished pages are already saved in your browser; "Resume" starts a new job for the rest).
* Progressive rendering (not full windowing) handles large libraries; very large books store one DB row per page, so reading stays cheap.
* PDF.js and Tesseract run in Web Workers; EPUB/DOCX parsing runs on the main thread in async slices.
* OCR downloads its language model from a public CDN on first use (the document is never uploaded).
* UI primitives are shadcn-style components written by hand on Radix (no CLI-generated files).
* Accounts / cloud sync are out of scope; the "profile" is local.

## Troubleshooting

* **`Could not resolve "d"` when starting Vite**: a stray Yarn Plug'n'Play file (e.g. `~/.pnp.cjs`) in a parent directory confuses esbuild. [vite.config.ts](vite.config.ts) already works around it; you can also delete that file if unused.
* **"Narration server unreachable"**: run `npm run dev` (not only `dev:web`).
* **"Text-to-speech is not set up yet"**: set `TTS_PROVIDER` and the key in `.env`, restart the API.
