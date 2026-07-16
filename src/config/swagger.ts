import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'Playwright Scraper API',
      version: '1.0.0',
      description: 'Production-ready API for web scraping with Playwright and automated testing',
      contact: {
        name: 'API Support',
        url: 'https://github.com',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: '/',
        description: 'Current origin',
      },
    ],
    components: {
      securitySchemes: {
        ServiceToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Service-Token',
          description: 'Optional; required when PLAYWRIGHT_SERVICE_TOKEN is set. Bearer also accepted.',
        },
      },
      schemas: {
        Meta: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            durationMs: { type: 'integer' },
            targetUrl: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['durationMs', 'timestamp'],
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [false] },
            error: { type: 'string' },
            meta: { $ref: '#/components/schemas/Meta' },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'unhealthy'] },
            uptime: { type: 'number' },
            environment: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        ScrapeSite: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string', format: 'uri' },
          },
          required: ['title', 'url'],
        },
        Product: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            price: { type: 'string' },
            description: { type: 'string' },
            rating: { type: 'string' },
            url: { type: 'string', format: 'uri' },
          },
        },
        SmokeTestCheck: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            passed: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        SmokeTestResult: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['test-sites', 'ecommerce'] },
            passed: { type: 'boolean' },
            checks: {
              type: 'array',
              items: { $ref: '#/components/schemas/SmokeTestCheck' },
            },
            durationMs: { type: 'integer' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js', './dist/controllers/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
