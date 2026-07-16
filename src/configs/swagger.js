const swaggerJsdoc = require('swagger-jsdoc');

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } }
});

const response = (description, schemaRef = 'SuccessResponse') => ({
  description,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaRef}` } } }
});

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'EduRAG NodeJS/Core API',
    version: '1.0.0-week3-contract-v0.1',
    description: 'Foundation, Part 1 và Week 2 Part 2 APIs. RAG mock mode đã triển khai; remote contract v0.1 đã có NodeJS contract tests nhưng chưa chạy end-to-end với Python thật.'
  },
  servers: [{ url: 'http://localhost:5001', description: 'Docker demo default' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      internalBearer: { type: 'http', scheme: 'bearer', description: 'RAG_INTERNAL_TOKEN; never use a user JWT here.' }
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        required: ['success', 'message', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object' }
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['success', 'message', 'errorCode'],
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          errorCode: { type: 'string', example: 'VALIDATION_ERROR' }
        }
      },
      RegisterBody: {
        type: 'object',
        required: ['email', 'password', 'fullName', 'role'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', minLength: 8 },
          fullName: { type: 'string' },
          phone: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['STUDENT', 'TEACHER'] },
          studentCode: { type: 'string', description: 'Bắt buộc với STUDENT.' },
          dateOfBirth: { type: 'string', format: 'date', description: 'Bắt buộc với STUDENT.' },
          academicTitle: { type: 'string', nullable: true },
          degree: { type: 'string', nullable: true },
          department: { type: 'string', nullable: true }
        }
      },
      LoginBody: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password' }
        }
      },
      VerifyOtpBody: {
        type: 'object',
        required: ['email', 'otpCode'],
        properties: {
          email: { type: 'string', format: 'email' },
          otpCode: { type: 'string', pattern: '^\\d{6}$' }
        }
      },
      ForgotPasswordBody: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } }
      },
      ResetPasswordBody: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token: { type: 'string' },
          newPassword: { type: 'string', format: 'password', minLength: 8 }
        }
      },
      UpdateProfileBody: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          phone: { type: 'string', nullable: true },
          dateOfBirth: { type: 'string', format: 'date' },
          academicTitle: { type: 'string', nullable: true },
          degree: { type: 'string', nullable: true },
          department: { type: 'string', nullable: true }
        }
      },
      ChangePasswordBody: {
        type: 'object',
        required: ['oldPassword', 'newPassword'],
        properties: {
          oldPassword: { type: 'string', format: 'password' },
          newPassword: { type: 'string', format: 'password', minLength: 8 }
        }
      },
      UpdateStatusBody: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['PENDING', 'ACTIVE', 'LOCKED', 'REJECTED'] },
          reviewNote: { type: 'string', nullable: true, description: 'Bắt buộc khi reject Teacher.' },
          lockReason: { type: 'string', nullable: true, description: 'Bắt buộc khi lock user.' }
        }
      },
      DocumentUpdateBody: {
        type: 'object', required: ['title'],
        properties: { title: { type: 'string', minLength: 1, maxLength: 255 } }
      },
      ChatSessionBody: {
        type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 255 } }
      },
      ChatMessageBody: {
        type: 'object', required: ['content', 'clientRequestId'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 10000 },
          clientRequestId: { type: 'string', format: 'uuid' }
        }
      },
      ProcessingCallbackBody: {
        type: 'object', required: ['event_type', 'job_id', 'attempt_count'],
        properties: {
          event_type: { type: 'string', enum: ['PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELLED'] },
          job_id: { type: 'integer' },
          doc_id: { type: 'integer' },
          attempt_count: {
            type: 'integer',
            minimum: 1,
            description: 'Immutable processing-job attempt; never callback HTTP delivery retry.'
          },
          stage: { type: 'string', maxLength: 32 },
          chunks: {
            type: 'array',
            description: 'Complete manifest for successful INGEST. Preview-only chunks are rejected.',
            items: {
              type: 'object',
              required: ['chunk_index', 'chunk_text', 'content_hash'],
              oneOf: [
                { required: ['vector_node_id'] },
                { required: ['chunk_id'] }
              ],
              properties: {
                chunk_index: { type: 'integer', minimum: 0 },
                vector_node_id: { type: 'string', format: 'uuid' },
                chunk_id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Python compatibility alias for vector_node_id.'
                },
                chunk_text: { type: 'string', minLength: 1, maxLength: 65535 },
                content_hash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
                token_count: { type: 'integer', minimum: 1 },
                page_number: {
                  type: 'integer',
                  nullable: true,
                  description: 'Values <= 0 are normalized to null at the Node boundary.'
                },
                section_title: { type: 'string', maxLength: 500, nullable: true },
                source_locator: { type: 'object', nullable: true }
              }
            }
          },
          result: { type: 'object' },
          error: { type: 'object' }
        }
      }
    }
  },
  paths: {
    '/health': {
      get: { tags: ['System'], summary: 'Health check', responses: { 200: { description: 'Server is running.' } } }
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Đăng ký Student hoặc Teacher',
        description: 'Student được ACTIVE; Teacher được PENDING.',
        requestBody: jsonBody({ $ref: '#/components/schemas/RegisterBody' }),
        responses: { 201: response('Registered.'), 400: response('Invalid input.', 'ErrorResponse'), 409: response('Duplicate.', 'ErrorResponse') }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Đăng nhập ACTIVE user',
        requestBody: jsonBody({ $ref: '#/components/schemas/LoginBody' }),
        responses: { 200: response('Authenticated or Admin OTP required.'), 401: response('Invalid credentials.', 'ErrorResponse'), 403: response('Account not ACTIVE.', 'ErrorResponse') }
      }
    },
    '/api/auth/admin/verify-otp': {
      post: {
        tags: ['Auth'], summary: 'Xác minh Admin OTP',
        description: 'Email provider chưa tích hợp; development delivery phải bật rõ bằng env.',
        requestBody: jsonBody({ $ref: '#/components/schemas/VerifyOtpBody' }),
        responses: { 200: response('JWT issued.'), 400: response('OTP invalid/expired/revoked.', 'ErrorResponse') }
      }
    },
    '/api/auth/logout': {
      post: { tags: ['Auth'], summary: 'Stateless client-side logout', security: [{ bearerAuth: [] }], responses: { 200: response('Logged out.'), 401: response('Unauthorized.', 'ErrorResponse') } }
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Auth'], summary: 'Yêu cầu password reset',
        description: 'Luôn trả response chung; email provider chưa tích hợp.',
        requestBody: jsonBody({ $ref: '#/components/schemas/ForgotPasswordBody' }),
        responses: { 200: response('Request accepted.'), 400: response('Invalid input.', 'ErrorResponse') }
      }
    },
    '/api/auth/reset-password': {
      post: {
        tags: ['Auth'], summary: 'Reset password và tăng auth_version',
        requestBody: jsonBody({ $ref: '#/components/schemas/ResetPasswordBody' }),
        responses: { 200: response('Password reset.'), 400: response('Token invalid/expired/revoked.', 'ErrorResponse') }
      }
    },
    '/api/profile': {
      get: { tags: ['Profile'], summary: 'Xem profile', security: [{ bearerAuth: [] }], responses: { 200: response('Profile.'), 401: response('Unauthorized.', 'ErrorResponse') } },
      put: { tags: ['Profile'], summary: 'Cập nhật profile', security: [{ bearerAuth: [] }], requestBody: jsonBody({ $ref: '#/components/schemas/UpdateProfileBody' }), responses: { 200: response('Updated.'), 400: response('Invalid input.', 'ErrorResponse') } }
    },
    '/api/profile/password': {
      put: { tags: ['Profile'], summary: 'Đổi password và vô hiệu JWT cũ', security: [{ bearerAuth: [] }], requestBody: jsonBody({ $ref: '#/components/schemas/ChangePasswordBody' }), responses: { 200: response('Changed.'), 400: response('Current password incorrect.', 'ErrorResponse') } }
    },
    '/api/admin/users': {
      get: {
        tags: ['Admin'], summary: 'List users (ADMIN)', security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['STUDENT', 'TEACHER', 'ADMIN'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'ACTIVE', 'LOCKED', 'REJECTED'] } }
        ],
        responses: { 200: response('Users.'), 403: response('ADMIN required.', 'ErrorResponse') }
      }
    },
    '/api/admin/users/{id}': {
      get: { tags: ['Admin'], summary: 'User detail (ADMIN)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('User.'), 404: response('Not found.', 'ErrorResponse') } }
    },
    '/api/admin/users/{id}/status': {
      put: {
        tags: ['Admin'], summary: 'Approve/reject/reopen/lock/unlock (ADMIN)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/UpdateStatusBody' }),
        responses: { 200: response('Status updated.'), 400: response('Invalid payload.', 'ErrorResponse'), 409: response('Invalid transition.', 'ErrorResponse') }
      }
    },
    '/api/documents': {
      get: {
        tags: ['Documents'], summary: 'List documents for TEACHER owner or ADMIN', security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'processingStatus', in: 'query', schema: { type: 'string', enum: ['UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED'] } },
          { name: 'visibilityStatus', in: 'query', schema: { type: 'string', enum: ['VISIBLE', 'HIDDEN', 'DELETED'] } }
        ],
        responses: { 200: response('Document page.'), 403: response('Document manager role required.', 'ErrorResponse') }
      },
      post: {
        tags: ['Documents'], summary: 'Upload PDF, DOCX or TXT', security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: {
            type: 'object', required: ['file'],
            properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string', maxLength: 255 } }
          } } }
        },
        responses: { 202: response('Document/job accepted.'), 400: response('Invalid file.', 'ErrorResponse'), 413: response('File too large.', 'ErrorResponse'), 503: response('Remote RAG dispatch failed.', 'ErrorResponse') }
      }
    },
    '/api/documents/{id}': {
      get: { tags: ['Documents'], summary: 'Document detail', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Document detail.'), 404: response('Not found or not owned.', 'ErrorResponse') } },
      patch: { tags: ['Documents'], summary: 'Update immutable document title only', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody({ $ref: '#/components/schemas/DocumentUpdateBody' }), responses: { 200: response('Updated.'), 409: response('Deleted document.', 'ErrorResponse') } },
      delete: { tags: ['Documents'], summary: 'Soft-delete document through operation job', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 202: response('Delete operation accepted.'), 503: response('RAG operation failed.', 'ErrorResponse') } }
    },
    '/api/documents/{id}/file': {
      get: { tags: ['Documents'], summary: 'Stream original file for owner/Admin', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'File stream.' }, 404: response('Unavailable.', 'ErrorResponse') } }
    },
    '/api/documents/jobs/{jobId}': {
      get: { tags: ['Documents'], summary: 'Processing job status for owner/Admin', security: [{ bearerAuth: [] }], parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Processing job.'), 404: response('Not found.', 'ErrorResponse') } }
    },
    '/api/documents/{id}/hide': {
      post: { tags: ['Documents'], summary: 'Disable retrieval without deleting vectors', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 202: response('Hide operation accepted.'), 409: response('Invalid transition.', 'ErrorResponse') } }
    },
    '/api/documents/{id}/unhide': {
      post: { tags: ['Documents'], summary: 'Enable retrieval for READY document', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 202: response('Unhide operation accepted.'), 409: response('Invalid transition.', 'ErrorResponse') } }
    },
    '/api/internal/rag/processing-callback': {
      post: { tags: ['Internal RAG'], summary: 'Complete-manifest processing callback', security: [{ internalBearer: [] }], requestBody: jsonBody({ $ref: '#/components/schemas/ProcessingCallbackBody' }), responses: { 200: response('ACK, duplicate or stale ignored.'), 400: response('Invalid callback.', 'ErrorResponse'), 401: response('Invalid internal token.', 'ErrorResponse') } }
    },
    '/api/chat/sessions': {
      get: { tags: ['Chat'], summary: 'List own chat sessions', security: [{ bearerAuth: [] }], responses: { 200: response('Session page.') } },
      post: { tags: ['Chat'], summary: 'Create chat session', security: [{ bearerAuth: [] }], requestBody: jsonBody({ $ref: '#/components/schemas/ChatSessionBody' }), responses: { 201: response('Created.') } }
    },
    '/api/chat/sessions/{id}': {
      get: { tags: ['Chat'], summary: 'Own session and history', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('History.'), 404: response('Not found.', 'ErrorResponse') } },
      delete: { tags: ['Chat'], summary: 'Soft-delete own session', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted.' } } }
    },
    '/api/chat/sessions/{id}/messages': {
      get: { tags: ['Chat'], summary: 'Paginated history', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('History.') } },
      post: { tags: ['Chat'], summary: 'Persist question and query mock/remote RAG', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody({ $ref: '#/components/schemas/ChatMessageBody' }), responses: { 200: response('Assistant result.'), 502: response('RAG response invalid/failed.', 'ErrorResponse'), 503: response('RAG unavailable.', 'ErrorResponse') } }
    },
    '/api/citations/{id}': {
      get: { tags: ['Citations'], summary: 'Authorized immutable citation snapshot', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Citation.'), 404: response('Not found.', 'ErrorResponse') } }
    },
    '/api/citations/{id}/source': {
      get: { tags: ['Citations'], summary: 'Citation snapshot and original availability', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Source snapshot.') } }
    },
    '/api/citations/{id}/file': {
      get: { tags: ['Citations'], summary: 'Stream authorized original source', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'File stream.' }, 409: response('Original unavailable; snapshot remains.', 'ErrorResponse') } }
    },
    '/api/admin/dashboard/summary': {
      get: { tags: ['Admin Dashboard'], summary: 'Basic LLM-calls-only summary', security: [{ bearerAuth: [] }], parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { 200: response('Dashboard summary.'), 403: response('ADMIN required.', 'ErrorResponse') } }
    }
  }
};

module.exports = swaggerJsdoc({ definition, apis: [] });
