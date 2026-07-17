// Express Application Configuration
require('dotenv').config();

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./configs/swagger');
const ragConfig = require('./configs/rag');

const responseMiddleware = require('./middlewares/response-middleware');
const { notFound, errorHandler } = require('./middlewares/error-middleware');

const authRoutes = require('./routes/auth-routes');
const userRoutes = require('./routes/user-routes');
const documentRoutes = require('./routes/document-routes');
const internalRagRoutes = require('./routes/internal-rag-routes');
const chatRoutes = require('./routes/chat-routes');
const citationRoutes = require('./routes/citation-routes');
const dashboardRoutes = require('./routes/dashboard-routes');

const app = express();

// The internal complete-manifest callback can be larger than the public JSON API.
// Keep this route-specific so unauthenticated public endpoints retain Express's 100 KB default.
app.use(
  '/api/internal/rag',
  express.json({ limit: ragConfig.callbackBodyLimit }),
  responseMiddleware,
  internalRagRoutes
);

// ─────────────────────────────────────────────
// 1. Body Parsing
// ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// 2. Response Helper Middleware
// ─────────────────────────────────────────────
app.use(responseMiddleware);

// ─────────────────────────────────────────────
// 3. Ignore browser auto-requests (API server only)
// ─────────────────────────────────────────────
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ─────────────────────────────────────────────
// 4. Swagger UI  →  http://localhost:PORT/api-docs
// ─────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'VTC RAG API Docs',
  swaggerOptions: { persistAuthorization: true },
}));
// JSON spec cho Postman import
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ─────────────────────────────────────────────
// 5. Health Check Endpoint
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// ─────────────────────────────────────────────
// 6. API Routes
// ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', userRoutes);        // covers /api/profile and /api/admin/users
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/citations', citationRoutes);
app.use('/api/admin/dashboard', dashboardRoutes);

// ─────────────────────────────────────────────
// 7. 404 Not Found & Global Error Handler
// (Must be last in middleware chain)
// ─────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
