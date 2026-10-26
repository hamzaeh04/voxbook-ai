import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'

// jsdom's Blob lacks .text()/structured-clone support that IndexedDB and JSZip rely on.
globalThis.Blob = NodeBlob as unknown as typeof Blob
