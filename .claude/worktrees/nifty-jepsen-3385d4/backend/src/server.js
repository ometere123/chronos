import './config/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import vaultRoutes from './routes/vaults.js';
import bridgeRoutes from './routes/bridge.js';
import proofOfReservesRoutes from './routes/proofOfReserves.js';
import usersRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import { eventListenerService } from './services/eventListenerService.js';
import { bridgeTrackerService } from './services/bridgeTrackerService.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

function getAllowedOrigins() {
  const configuredOrigins = (process.env.FRONTEND_URL || process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  return process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS;
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: getAllowedOrigins(),
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      eventListener: eventListenerService.isRunning ? 'running' : 'stopped',
      bridgeTracker: bridgeTrackerService.isRunning ? 'running' : 'stopped'
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/vaults', vaultRoutes);
app.use('/api/bridge', bridgeRoutes);
app.use('/api/proof-of-reserves', proofOfReservesRoutes);
app.use('/api/users', usersRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (last middleware)
app.use(errorHandler);

// Start server and background services
const server = app.listen(PORT);

server.on('listening', () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start background services
  eventListenerService.start();
  bridgeTrackerService.start();

  logger.info('Background services started');
});

server.on('error', (err) => {
  logger.error('Server failed to start', {
    error: err.message,
    code: err.code,
  });

  process.exitCode = 1;
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');

  // Stop background services
  eventListenerService.stop();
  bridgeTrackerService.stop();

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
