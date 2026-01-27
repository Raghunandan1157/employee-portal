#!/usr/bin/env python3
"""
Simple HTTP server for the Employee Portal.
Run this file and it will automatically open the login page in your browser.
"""

import http.server
import socketserver
import os
import webbrowser
import threading

PORT = 3000

# Change to the directory where this script is located
os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = http.server.SimpleHTTPRequestHandler

# Set proper MIME types
Handler.extensions_map.update({
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
})

def open_browser():
    """Open the browser after a short delay to ensure server is ready."""
    webbrowser.open(f"http://localhost:{PORT}/index.html")

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with ReusableTCPServer(("", PORT), Handler) as httpd:
    print(f"\n{'='*50}")
    print(f"  Employee Portal Server")
    print(f"{'='*50}")
    print(f"\n  Server running at: http://localhost:{PORT}")
    print(f"  Opening login page in browser...")
    print(f"\n  Press Ctrl+C to stop the server")
    print(f"{'='*50}\n")

    # Open browser in a separate thread
    threading.Timer(0.5, open_browser).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
