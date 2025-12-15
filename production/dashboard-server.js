/**
 * Production Dashboard Server
 * Serves the web-based dashboard for Claude session monitoring
 */

const express = require('express');
const path = require('path');

class DashboardServer {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.telemetryBaseUrl = `http://${config.telemetry.host}:${config.telemetry.port}`;

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Enable CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      next();
    });
  }

  setupRoutes() {
    // Serve dashboard
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Proxy API requests to telemetry server
    this.app.use('/api', async (req, res) => {
      try {
        // Simple proxy to telemetry server
        const axios = require('axios');
        const response = await axios({
          method: req.method,
          url: `${this.telemetryBaseUrl}${req.url}`,
          data: req.body,
          params: req.query
        });
        res.json(response.data);
      } catch (error) {
        console.error('API proxy error:', error.message);
        res.status(error.response?.status || 500).json({
          error: error.message
        });
      }
    });

    // WebSocket info endpoint
    this.app.get('/ws-config', (req, res) => {
      res.json({
        wsUrl: `ws://${this.config.dashboard.host}:${this.config.dashboard.wsPort}`
      });
    });
  }

  start() {
    this.app.listen(this.config.dashboard.port, this.config.dashboard.host, () => {
      console.log(`✓ Dashboard server listening on http://${this.config.dashboard.host}:${this.config.dashboard.port}`);
      console.log(`✓ WebSocket available on ws://${this.config.dashboard.host}:${this.config.dashboard.wsPort}`);
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const config = require('./config/production.json');
  const server = new DashboardServer(config);
  server.start();
}

module.exports = DashboardServer;