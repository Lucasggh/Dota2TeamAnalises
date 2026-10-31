#!/usr/bin/env python3
"""
Servidor Web local simples em Python 3 nativo.
Execução: python server.py
"""

import http.server
import socketserver
import webbrowser
import os

PORT = 3000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print("=" * 52)
        print("   Dota 2 Rival Scout - Servidor Iniciado!")
        print(f"   Acesse no navegador: {url}")
        print("   Pressione Ctrl + C para encerrar")
        print("=" * 52)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor encerrado.")
