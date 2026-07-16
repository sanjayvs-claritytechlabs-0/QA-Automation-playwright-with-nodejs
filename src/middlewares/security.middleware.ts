import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import env from '../config/env';

export const securityMiddleware = helmet({
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
});

export const corsMiddleware = cors({
  origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
  credentials: env.CORS_ORIGIN !== '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Token'],
});

export const compressionMiddleware = compression();
