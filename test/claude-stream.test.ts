import { describe, expect, it } from 'vitest'
import { readMessageStream } from '../src/engine/claude'

function sse(...events: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      controller.close()
    },
  })
}

describe('reading the message stream', () => {
  it('reassembles text and usage', async () => {
    const out = await readMessageStream(
      sse(
        { type: 'message_start', message: { usage: { input_tokens: 900 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        { type: 'message_delta', usage: { output_tokens: 42 } },
        { type: 'message_stop' },
      ),
    )
    expect(out).toMatchObject({ text: 'Hello world', inputTokens: 900, outputTokens: 42, sawStop: true })
  })

  it('reports a stream that ended without message_stop', async () => {
    // A cut stream must not pass its partial text off as an answer — that is
    // how a truncated post reaches the judge looking complete.
    const out = await readMessageStream(
      sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }),
    )
    expect(out.sawStop).toBe(false)
  })

  it('ignores unparseable lines rather than dying mid-stream', async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {broken json\n'))
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })}\n`))
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'message_stop' })}\n`))
        controller.close()
      },
    })
    const out = await readMessageStream(stream)
    expect(out.text).toBe('ok')
    expect(out.sawStop).toBe(true)
  })

  it('handles events split across chunks', async () => {
    const enc = new TextEncoder()
    const full = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'split works' } })}\ndata: ${JSON.stringify({ type: 'message_stop' })}\n`
    const mid = Math.floor(full.length / 2)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(full.slice(0, mid)))
        controller.enqueue(enc.encode(full.slice(mid)))
        controller.close()
      },
    })
    const out = await readMessageStream(stream)
    expect(out.text).toBe('split works')
  })
})
