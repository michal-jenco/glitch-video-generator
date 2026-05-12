"""Static dev server with correct MIME types.

Python's built-in http.server serves .mjs as text/plain, which modern
browsers refuse as ES modules. This wrapper registers the missing types.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SimpleHTTPRequestHandler.extensions_map.update({
    '.mjs': 'application/javascript',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
})

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ThreadingHTTPServer(('', port), SimpleHTTPRequestHandler).serve_forever()
