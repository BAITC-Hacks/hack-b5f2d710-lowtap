// Разбор text/event-stream из fetch + ReadableStream (EventSource не умеет POST).

export interface SSEMessage {
  event: string
  data: string
}

/** Парсер потока: принимает куски текста в любом разбиении, вызывает onMessage на каждое событие. */
export function createSSEParser(onMessage: (message: SSEMessage) => void) {
  let buffer = ''
  let event = ''
  let data: string[] = []

  function dispatch() {
    if (data.length) onMessage({ event: event || 'message', data: data.join('\n') })
    event = ''
    data = []
  }

  function line(text: string) {
    if (text === '') return dispatch()
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  return {
    push(chunk: string) {
      buffer += chunk
      // «\r» в конце куска может оказаться половиной «\r\n» — ждём следующий кусок.
      const holdCR = buffer.endsWith('\r')
      const lines = (holdCR ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/)
      buffer = (lines.pop() ?? '') + (holdCR ? '\r' : '')
      lines.forEach(line)
    },
    /** Конец потока: незавершённое событие тоже доставляется. */
    end() {
      const rest = buffer.replace(/\r$/, '')
      if (rest) line(rest)
      buffer = ''
      dispatch()
    },
  }
}

export async function readSSE(body: ReadableStream<Uint8Array>, onMessage: (message: SSEMessage) => void): Promise<void> {
  const parser = createSSEParser(onMessage)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }
  parser.push(decoder.decode())
  parser.end()
}
