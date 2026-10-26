export type DocErrorCode = 'unsupported' | 'too_large' | 'empty' | 'corrupt' | 'encrypted' | 'no_text' | 'cancelled'

export class DocumentError extends Error {
  constructor(
    public code: DocErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DocumentError'
  }
}
