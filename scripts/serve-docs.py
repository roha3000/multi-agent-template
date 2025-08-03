#!/usr/bin/env python3
"""
serve-docs.py - Local documentation server
Serves documentation on http://localhost:8000
"""

import http.server
import socketserver
import os
import webbrowser
from pathlib import Path

def serve_docs(port=8000):
    """Serve documentation locally"""
    # Change to project root directory
    project_root = Path(__file__).parent.parent
    os.chdir(project_root)
    
    # Create simple HTTP server
    handler = http.server.SimpleHTTPRequestHandler
    
    try:
        with socketserver.TCPServer(("", port), handler) as httpd:
            print(f"📚 Serving documentation at http://localhost:{port}")
            print("📖 Available documentation:")
            print(f"   • Main: http://localhost:{port}/README.html")  
            print(f"   • Setup: http://localhost:{port}/SETUP.html")
            print(f"   • Workflow: http://localhost:{port}/WORKFLOW.html")
            print(f"   • Templates: http://localhost:{port}/TEMPLATE-GUIDE.html")
            print(f"   • Commands: http://localhost:{port}/.claude/commands/")
            print("\n🔄 Press Ctrl+C to stop server")
            
            # Open browser automatically
            webbrowser.open(f"http://localhost:{port}/README.html")
            
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n✅ Documentation server stopped")

if __name__ == "__main__":
    serve_docs()