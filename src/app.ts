import 'dotenv/config';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorMiddleware } from './middlewares/error.middleware';
import { notFoundMiddleware } from './middlewares/not-found.middleware';
import { requestLoggerMiddleware } from './middlewares/request-logger.middleware';
import { rateLimitMiddleware } from './middlewares/rate-limit.middleware';
import { securityMiddleware, corsMiddleware, compressionMiddleware } from './middlewares/security.middleware';
import healthRoutes from './routes/health.routes';
import scrapeRoutes from './routes/scrape.routes';
import testRoutes from './routes/test.routes';
import qaRoutes from './routes/qa.routes';
import { getHealth } from './controllers/health.controller';

export const createApp = () => {
  const app = express();

  // Trust proxy
  app.set('trust proxy', 1);

  // Security middleware
  app.use(securityMiddleware);
  app.use(corsMiddleware);
  app.use(compressionMiddleware);

  // Body parser — larger limit for execute case payloads
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  // Request logging
  app.use(requestLoggerMiddleware);

  // Rate limiting
  app.use(rateLimitMiddleware);

  // Root endpoint redirects users to interactive API documentation
  app.get('/', (_req, res) => {
    return res.redirect('/docs');
  });

  // Swagger/OpenAPI documentation
  app.get('/openapi.json', (_req, res) => {
    return res.json(swaggerSpec);
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Playwright Scraper API - Swagger UI',
    swaggerOptions: {
      persistAuthorization: true,
    },
  }));

  // Health endpoint (outside routes for better availability)
  app.get('/health', getHealth);

  // QA Automation contracts (PRD 06/07/09) — root paths
  app.use(qaRoutes);

  // Legacy scrape / smoke routes
  app.use('/health', healthRoutes);
  app.use('/api/scrape', scrapeRoutes);
  app.use('/api/tests/smoke', testRoutes);

  // 404 handler
  app.use(notFoundMiddleware);

  // Error handling middleware (must be last)
  app.use(errorMiddleware);

  return app;
};
