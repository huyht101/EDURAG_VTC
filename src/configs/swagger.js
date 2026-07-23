const swaggerJsdoc = require('swagger-jsdoc');

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } }
});

const response = (description, schemaRef = 'SuccessResponse', example) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${schemaRef}` },
      ...(example === undefined ? {} : { example })
    }
  }
});

const originalFileResponse = (description) => ({
  description,
  headers: {
    'Content-Disposition': {
      description: 'Always attachment; cross-origin JavaScript cannot read this header until Node exposes it through CORS.',
      schema: { type: 'string', example: 'attachment; filename="document.pdf"' }
    },
    'Content-Length': {
      description: 'Full file size. Byte Range/206 is not implemented.',
      schema: { type: 'integer', minimum: 1 }
    }
  },
  content: {
    'application/pdf': { schema: { type: 'string', format: 'binary' } },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      schema: { type: 'string', format: 'binary' }
    },
    'text/plain': { schema: { type: 'string', format: 'binary' } }
  }
});

const citationSourceExample = {
  success: true,
  message: 'OK',
  data: {
    id: 43,
    messageId: 42,
    documentId: 12,
    chunkId: 88,
    citationOrder: 1,
    documentTitle: 'Tài liệu demo',
    pageNumber: 1,
    sectionTitle: null,
    sourceText: 'Structured source fragment.',
    sourceLocator: null,
    retrievalScore: 0.91,
    rerankScore: null,
    originalAvailable: true
  }
};

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'EduRAG NodeJS/Core API',
    version: '1.0.0-week3-contract-v0.1',
    description: 'Foundation, Part 1 và Week 2 Part 2 APIs. Mock regression và remote boundary fixtures không thay thế live Python E2E; historical live evidence chỉ áp dụng cho topology development được tài liệu hóa.'
  },
  servers: [{ url: 'http://localhost:5001', description: 'Docker demo default' }],
  tags: [
    { name: 'Authentication', description: 'Đăng ký, đăng nhập, Admin OTP, logout và password recovery; public sensitive operations có per-process rate limit.' },
    { name: 'Profile', description: 'ACTIVE user đọc/cập nhật profile và đổi password của chính mình.' },
    { name: 'Admin - Users', description: 'ADMIN quản lý trạng thái và tra cứu tài khoản.' },
    { name: 'Documents', description: 'TEACHER quản lý tài liệu mình upload; ADMIN quản lý toàn bộ.' },
    { name: 'Document Processing', description: 'Theo dõi processing job bất đồng bộ sau upload/hide/unhide/delete.' },
    { name: 'Chat Sessions', description: 'ACTIVE user quản lý các chat session thuộc chính mình.' },
    { name: 'Chat Messages', description: 'ACTIVE user đọc history và gửi câu hỏi trong session của chính mình.' },
    { name: 'Citations', description: 'Đọc immutable citation snapshot và original source khi còn khả dụng.' },
    { name: 'Admin Dashboard', description: 'ADMIN đọc thống kê cơ bản; usage chỉ phản ánh llm_usage_logs.' },
    { name: 'Internal RAG', description: 'Service-to-service only. Dùng internal Bearer, không dùng user JWT và không dành cho Web/Mobile/Swagger tester thông thường.' },
    { name: 'System', description: 'Runtime health endpoint.' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access JWT constrained by issuer/audience/purpose/authVersion; logout revokes all previously issued tokens.' },
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
          email: {
            type: 'string', format: 'email',
            description: 'Format-only validation for both roles; runtime does not enforce @student.edu.vn or a Teacher domain.'
          },
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
        type: 'object', required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 10000, example: 'Tài liệu mô tả nội dung chính nào?' },
          clientRequestId: {
            type: 'string', format: 'uuid', nullable: true,
            description: 'Optional idempotency key. Omit/null/blank để server sinh UUID; tái sử dụng cùng UUID khi retry an toàn.'
          }
        },
        example: { content: 'Tài liệu mô tả nội dung chính nào?' }
      },
      CitationSnapshot: {
        type: 'object',
        required: ['id', 'messageId', 'citationOrder', 'documentTitle', 'sourceText'],
        properties: {
          id: { type: 'integer' },
          messageId: { type: 'integer' },
          documentId: { type: 'integer', nullable: true },
          chunkId: { type: 'integer', nullable: true },
          citationOrder: { type: 'integer', minimum: 1 },
          documentTitle: { type: 'string' },
          pageNumber: { type: 'integer', minimum: 1, nullable: true },
          sectionTitle: { type: 'string', nullable: true },
          sourceText: { type: 'string' },
          sourceLocator: {
            type: 'object', nullable: true,
            description: 'Opaque optional object. Current Python runtime does not emit locator/boxes and no coordinate schema is defined.'
          },
          retrievalScore: { type: 'number', nullable: true },
          rerankScore: { type: 'number', nullable: true }
        },
        description: 'Immutable public snapshot. vectorNodeId remains an internal mapping key and is not serialized.'
      },
      ProcessingChunkManifestItem: {
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
            description: 'Python runtime alias for vector_node_id.'
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
      },
      ProcessingCallbackBody: {
        type: 'object', required: ['event_type', 'job_id', 'attempt_count'],
        properties: {
          event_type: { type: 'string', enum: ['PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELLED'] },
          job_id: {
            oneOf: [
              { type: 'integer', minimum: 1 },
              { type: 'string', pattern: '^[1-9]\\d*$' }
            ],
            description: 'Python echoes the Node processing job ID as a string.'
          },
          doc_id: {
            oneOf: [
              { type: 'integer', minimum: 1 },
              { type: 'string', pattern: '^[1-9]\\d*$' }
            ],
            description: 'Optional; Node resolves the document through the processing job when omitted.'
          },
          attempt_count: {
            type: 'integer',
            minimum: 1,
            description: 'Immutable processing-job attempt; never callback HTTP delivery retry.'
          },
          stage: { type: 'string', maxLength: 32 },
          chunks: {
            type: 'array',
            description: 'Node compatibility alias for a complete manifest.',
            items: { $ref: '#/components/schemas/ProcessingChunkManifestItem' }
          },
          chunk_manifest: {
            type: 'array',
            description: 'Python runtime field for the complete manifest. Preview-only chunks are rejected.',
            items: { $ref: '#/components/schemas/ProcessingChunkManifestItem' }
          },
          result: { type: 'object' },
          error: { type: 'object' }
        }
      }
    }
  },
  paths: {
    '/health': {
      get: { tags: ['System'], summary: 'Process liveness', responses: { 200: { description: 'Node process is serving HTTP.' } } }
    },
    '/ready': {
      get: { tags: ['System'], summary: 'Node/MySQL readiness', responses: { 200: { description: 'Node and MySQL are ready.' }, 503: { description: 'MySQL is temporarily unavailable.' } } }
    },
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Đăng ký Student hoặc Teacher',
        description: 'Student được ACTIVE; Teacher được PENDING.',
        requestBody: jsonBody({ $ref: '#/components/schemas/RegisterBody' }),
        responses: { 201: response('Registered.'), 400: response('Invalid input.', 'ErrorResponse'), 409: response('Duplicate.', 'ErrorResponse'), 429: response('Per-process rate limit exceeded.', 'ErrorResponse') }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'], summary: 'Đăng nhập ACTIVE user',
        requestBody: jsonBody({ $ref: '#/components/schemas/LoginBody' }),
        responses: { 200: response('Authenticated or Admin OTP required.'), 401: response('Invalid credentials.', 'ErrorResponse'), 403: response('Account not ACTIVE.', 'ErrorResponse'), 429: response('Per-process rate limit exceeded.', 'ErrorResponse') }
      }
    },
    '/api/auth/admin/verify-otp': {
      post: {
        tags: ['Authentication'], summary: 'Xác minh Admin OTP',
        description: 'Email provider chưa tích hợp; development delivery phải bật rõ bằng env.',
        requestBody: jsonBody({ $ref: '#/components/schemas/VerifyOtpBody' }),
        responses: { 200: response('JWT issued.'), 400: response('OTP invalid/expired/revoked.', 'ErrorResponse'), 429: response('Strict per-process rate limit exceeded.', 'ErrorResponse') }
      }
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Logout all devices',
        description: 'Increments the current user auth_version. Every access JWT issued before this request becomes invalid; a request already authorized may finish.',
        security: [{ bearerAuth: [] }],
        responses: { 200: response('All existing access tokens were revoked.'), 401: response('Unauthorized.', 'ErrorResponse') }
      }
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Authentication'], summary: 'Yêu cầu password reset',
        description: 'Luôn trả response chung; email provider chưa tích hợp.',
        requestBody: jsonBody({ $ref: '#/components/schemas/ForgotPasswordBody' }),
        responses: { 200: response('Request accepted.'), 400: response('Invalid input.', 'ErrorResponse'), 429: response('Strict per-process rate limit exceeded.', 'ErrorResponse') }
      }
    },
    '/api/auth/reset-password': {
      post: {
        tags: ['Authentication'], summary: 'Reset password và tăng auth_version',
        requestBody: jsonBody({ $ref: '#/components/schemas/ResetPasswordBody' }),
        responses: { 200: response('Password reset.'), 400: response('Token invalid/expired/revoked.', 'ErrorResponse'), 429: response('Strict per-process rate limit exceeded.', 'ErrorResponse') }
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
        tags: ['Admin - Users'], summary: 'List users (ADMIN)', security: [{ bearerAuth: [] }],
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
      get: { tags: ['Admin - Users'], summary: 'User detail (ADMIN)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('User.'), 404: response('Not found.', 'ErrorResponse') } }
    },
    '/api/admin/users/{id}/status': {
      put: {
        tags: ['Admin - Users'], summary: 'Approve/reject/reopen/lock/unlock (ADMIN)', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: jsonBody({ $ref: '#/components/schemas/UpdateStatusBody' }),
        responses: { 200: response('Status updated.'), 400: response('Invalid payload.', 'ErrorResponse'), 409: response('Invalid transition.', 'ErrorResponse') }
      }
    },
    '/api/documents': {
      get: {
        tags: ['Documents'], summary: 'List documents for STUDENT, TEACHER or ADMIN', security: [{ bearerAuth: [] }],
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
        responses: {
          202: response('Document/job accepted; processing is not complete yet.', 'SuccessResponse', {
            success: true,
            message: 'Document đã được tiếp nhận để xử lý.',
            data: {
              document: { id: 12, processingStatus: 'PROCESSING', visibilityStatus: 'VISIBLE' },
              job: { id: 34, jobType: 'INGEST', status: 'RUNNING', attemptCount: 1 }
            }
          }),
          400: response('Invalid file.', 'ErrorResponse'),
          413: response('File too large.', 'ErrorResponse'),
          503: response('Remote RAG dispatch failed; document/job are marked FAILED.', 'ErrorResponse')
        }
      }
    },
    '/api/documents/{id}': {
      get: { tags: ['Documents'], summary: 'Document detail', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Document detail.'), 404: response('Not found or not owned.', 'ErrorResponse') } },
      patch: { tags: ['Documents'], summary: 'Update immutable document title only', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: jsonBody({ $ref: '#/components/schemas/DocumentUpdateBody' }), responses: { 200: response('Updated.'), 409: response('Deleted document.', 'ErrorResponse') } },
      delete: { tags: ['Documents'], summary: 'Soft-delete document through operation job', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 202: response('Delete operation accepted.'), 503: response('RAG operation failed.', 'ErrorResponse') } }
    },
    '/api/documents/{id}/file': {
      get: { tags: ['Documents'], summary: 'Download original file for owner/Admin', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: originalFileResponse('Original PDF/DOCX/TXT attachment stream; no derived preview and no Range/206.'), 404: response('Unavailable.', 'ErrorResponse') } }
    },
    '/api/documents/jobs/{jobId}': {
      get: { tags: ['Document Processing'], summary: 'Processing job status for owner/Admin', security: [{ bearerAuth: [] }], parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Processing job.', 'SuccessResponse', { success: true, message: 'OK', data: { id: 34, documentId: 12, jobType: 'INGEST', status: 'SUCCEEDED', currentStage: 'COMPLETED', attemptCount: 1, totalChunks: 8 } }), 404: response('Not found.', 'ErrorResponse') } }
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
      get: { tags: ['Chat Sessions'], summary: 'List own chat sessions', security: [{ bearerAuth: [] }], parameters: [{ name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }], responses: { 200: response('Session page.') } },
      post: { tags: ['Chat Sessions'], summary: 'Create chat session', security: [{ bearerAuth: [] }], requestBody: jsonBody({ $ref: '#/components/schemas/ChatSessionBody' }), responses: { 201: response('Created.') } }
    },
    '/api/chat/sessions/{id}': {
      get: { tags: ['Chat Sessions'], summary: 'Own session detail with history', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }], responses: { 200: response('History.'), 404: response('Not found.', 'ErrorResponse') } },
      delete: { tags: ['Chat Sessions'], summary: 'Soft-delete own session', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 204: { description: 'Deleted.' } } }
    },
    '/api/chat/sessions/{id}/messages': {
      get: { tags: ['Chat Messages'], summary: 'List paginated session messages', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }], responses: { 200: response('History ordered by messageOrder; PENDING/COMPLETED/FAILED messages are included.', 'SuccessResponse', { success: true, message: 'OK', data: { session: { id: 9, title: 'Demo chat', lastMessageAt: null, createdAt: '2026-07-22T08:00:00.000Z', updatedAt: '2026-07-22T08:00:00.000Z' }, offset: 0, limit: 50, total: 1, messages: [{ id: 41, sessionId: 9, senderType: 'USER', messageOrder: 1, content: 'Tài liệu mô tả nội dung chính nào?', status: 'COMPLETED', noAnswer: false, clientRequestId: '35ad0d0e-a423-4b06-a643-9a8391a6a4da', errorCode: null, completedAt: '2026-07-22T08:30:00.000Z', createdAt: '2026-07-22T08:30:00.000Z', citations: [] }] } }) } },
      post: { tags: ['Chat Messages'], summary: 'Send text question with idempotent response', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatMessageBody' }, examples: { simple: { summary: 'Swagger/simple request; server generates clientRequestId', value: { content: 'Tài liệu mô tả nội dung chính nào?' } }, safeRetry: { summary: 'Advanced retry with client-controlled idempotency UUID', value: { content: 'Tài liệu mô tả nội dung chính nào?', clientRequestId: '35ad0d0e-a423-4b06-a643-9a8391a6a4da' } } } } } }, responses: { 200: response('New requests wait for final completion; duplicate requests return the current PENDING/COMPLETED/FAILED pair.', 'SuccessResponse', { success: true, message: 'Chat response completed.', data: { duplicate: false, clientRequestId: '35ad0d0e-a423-4b06-a643-9a8391a6a4da', userMessageId: 41, assistantMessage: { id: 42, status: 'COMPLETED', content: 'Câu trả lời có nguồn.', noAnswer: false, citations: [{ id: 43, messageId: 42, documentId: 12, chunkId: 88, citationOrder: 1, documentTitle: 'Tài liệu demo', pageNumber: 1, sectionTitle: null, sourceText: 'Structured source fragment.', sourceLocator: null, retrievalScore: 0.91, rerankScore: null }] } } }), 409: response('clientRequestId belongs to another session.', 'ErrorResponse'), 502: response('RAG response invalid, including a sourced answer without a verifiable structured citation.', 'ErrorResponse'), 503: response('RAG unavailable or timed out.', 'ErrorResponse') } }
    },
    '/api/citations/{id}': {
      get: { tags: ['Citations'], summary: 'Authorized immutable citation snapshot', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Citation snapshot with original availability.', 'SuccessResponse', citationSourceExample), 404: response('Not found.', 'ErrorResponse') } }
    },
    '/api/citations/{id}/source': {
      get: { tags: ['Citations'], summary: 'Citation snapshot and original availability', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: response('Source snapshot.', 'SuccessResponse', citationSourceExample), 404: response('Not found.', 'ErrorResponse') } }
    },
    '/api/citations/{id}/file': {
      get: { tags: ['Citations'], summary: 'Download authorized original source', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: originalFileResponse('Original PDF/DOCX/TXT attachment stream; no derived preview and no Range/206.'), 409: response('Original unavailable; snapshot remains.', 'ErrorResponse') } }
    },
    '/api/admin/dashboard/summary': {
      get: { tags: ['Admin Dashboard'], summary: 'Basic LLM-calls-only summary', security: [{ bearerAuth: [] }], parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { 200: response('Dashboard summary.'), 403: response('ADMIN required.', 'ErrorResponse') } }
    }
  }
};

const operationDescriptions = {
  'GET /health': 'Actor: public monitoring. Kiểm tra NodeJS process đang phục vụ request; không kiểm tra toàn bộ MySQL/Python/Qdrant topology.',
  'GET /ready': 'Actor: public orchestration. Kiểm tra NodeJS và một truy vấn MySQL nhẹ; không chứng minh Python, Qdrant hoặc provider đang khỏe.',
  'POST /api/auth/register': 'Actor: public. Tạo STUDENT ở trạng thái ACTIVE hoặc TEACHER ở trạng thái PENDING chờ ADMIN review; không cấp quyền quản lý document cho STUDENT.',
  'POST /api/auth/login': 'Actor: public account owner. Chỉ ACTIVE user đăng nhập được; ADMIN phải hoàn tất OTP trước khi nhận user JWT.',
  'POST /api/auth/admin/verify-otp': 'Actor: ADMIN đang đăng nhập. Xác minh OTP development/email delivery và trả user JWT; OTP expired/used/revoked không được dùng lại.',
  'POST /api/auth/logout': 'Actor: authenticated user. Logout-all increments auth_version and revokes every access JWT issued earlier; the client must still delete its local token.',
  'POST /api/auth/forgot-password': 'Actor: public. Tạo password-reset request với response chống account enumeration; development delivery không đồng nghĩa email production-ready.',
  'POST /api/auth/reset-password': 'Actor: người giữ reset token. Đổi password, tăng auth_version và consume token trong transaction; JWT cũ mất hiệu lực.',
  'GET /api/profile': 'Actor: ACTIVE authenticated user. Chỉ đọc profile và role/status hiện tại của chính mình.',
  'PUT /api/profile': 'Actor: ACTIVE authenticated user. Chỉ mutate các profile field được role hiện tại cho phép; không đổi role/status.',
  'PUT /api/profile/password': 'Actor: ACTIVE authenticated user. Kiểm tra password hiện tại, đổi password và tăng auth_version để vô hiệu JWT cũ.',
  'GET /api/admin/users': 'Actor: ADMIN. Đọc danh sách user có pagination/filter; không dành cho TEACHER/STUDENT.',
  'GET /api/admin/users/{id}': 'Actor: ADMIN. Đọc account/profile detail của user theo id; không trả password/token hash.',
  'PUT /api/admin/users/{id}/status': 'Actor: ADMIN. Thực hiện approve/reject/reopen/lock/unlock theo transition hợp lệ; lock tăng auth_version.',
  'GET /api/documents': 'Actor: STUDENT, TEACHER hoặc ADMIN. TEACHER chỉ thấy document mình upload, ADMIN và STUDENT thấy toàn bộ; mặc định không list DELETED.',
  'POST /api/documents': 'Actor: TEACHER hoặc ADMIN. Validate và lưu PDF/DOCX/TXT (DOCX phải là bounded OOXML archive), tạo document + INGEST job rồi dispatch Python. HTTP 202 chỉ là accepted; tiếp theo poll GET /api/documents/jobs/{jobId} đến SUCCEEDED và kiểm tra document READY.',
  'GET /api/documents/{id}': 'Actor: document owner TEACHER hoặc ADMIN. Đọc metadata và latest job; storage_key không được public.',
  'PATCH /api/documents/{id}': 'Actor: document owner TEACHER hoặc ADMIN. Chỉ đổi title; file gốc immutable và muốn thay nội dung phải upload document mới.',
  'DELETE /api/documents/{id}': 'Actor: document owner TEACHER hoặc ADMIN. Tạo async DELETE_VECTORS job rồi soft-delete business document; poll job status. Chat/citation snapshot không bị xóa.',
  'GET /api/documents/{id}/file': 'Actor: document owner TEACHER hoặc ADMIN. Stream original PDF/DOCX/TXT as attachment khi local upload còn tồn tại. Không có derived preview hoặc byte Range/206; nếu corpus original chưa được materialize về upload volume thì trả FILE_NOT_FOUND.',
  'GET /api/documents/jobs/{jobId}': 'Actor: owner của document hoặc ADMIN. Poll trạng thái QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED; document chỉ dùng cho retrieval sau khi INGEST SUCCEEDED và processingStatus READY.',
  'POST /api/documents/{id}/hide': 'Actor: document owner TEACHER hoặc ADMIN. Tạo async SET_RETRIEVAL job để loại document khỏi retrieval nhưng giữ vectors và citation/history; poll job status.',
  'POST /api/documents/{id}/unhide': 'Actor: document owner TEACHER hoặc ADMIN. Tạo async SET_RETRIEVAL job để bật lại READY document; poll job status trước khi chat.',
  'POST /api/internal/rag/processing-callback': 'Service-to-service only: Python RAG gọi bằng internal Bearer. Không dùng user JWT, không dành cho Web/Mobile/Swagger tester. Node validate attempt/idempotency/manifest rồi persist MySQL.',
  'GET /api/chat/sessions': 'Actor: ACTIVE authenticated user. Chỉ list session chưa soft-delete của chính user, theo offset/limit; ADMIN không tự động đọc chat người khác.',
  'POST /api/chat/sessions': 'Actor: ACTIVE authenticated user. Tạo session thuộc chính user; title optional và chưa gọi Python/RAG.',
  'GET /api/chat/sessions/{id}': 'Actor: session owner. Đọc session detail kèm paginated messages/citations; endpoint read-only và không mở quyền ADMIN đọc session người khác.',
  'DELETE /api/chat/sessions/{id}': 'Actor: session owner. Soft-delete session; messages, citations và usage vẫn được giữ trong MySQL nhưng session không còn xuất hiện qua public history APIs.',
  'GET /api/chat/sessions/{id}/messages': 'Actor: session owner. Đọc messages theo message_order với offset/limit; PENDING/COMPLETED/FAILED đều xuất hiện và assistant message gồm citation snapshots, không bao gồm usage rows.',
  'POST /api/chat/sessions/{id}/messages': 'Actor: session owner. Supported contract là JSON text, không có multipart/image. Request mới persist USER + ASSISTANT PENDING, chờ Python/LLM và success trả assistant COMPLETED. Duplicate clientRequestId trả pair hiện hữu nên có thể PENDING/COMPLETED/FAILED; PENDING được theo dõi qua history. Không có SSE/WebSocket. no_answer=true là success hợp lệ; normal answer bắt buộc có verified structured citation.',
  'GET /api/citations/{id}': 'Actor: owner của chat session chứa citation. Đọc immutable citation snapshot; không phụ thuộc document hiện còn visible hoặc original file còn tồn tại.',
  'GET /api/citations/{id}/source': 'Actor: owner của chat session chứa citation. Đọc source-text snapshot và cờ originalAvailable; sourceLocator là opaque optional object và current Python không tạo locator/boxes. Đây không phải stream file.',
  'GET /api/citations/{id}/file': 'Actor: owner của chat session chứa citation và current source authorization hợp lệ. Stream original as attachment; không có Range/206. Portable corpus thiếu original có thể trả ORIGINAL_SOURCE_UNAVAILABLE trong khi snapshot vẫn đọc được.',
  'GET /api/admin/dashboard/summary': 'Actor: ADMIN. Đọc document/chat/citation và LLM usage aggregates theo time range; không gọi đây là tổng OCR/embedding/Qdrant cost.'
};

for (const [path, pathItem] of Object.entries(definition.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    if (!pathItem[method]) continue;
    const key = `${method.toUpperCase()} ${path}`;
    if (!operationDescriptions[key]) throw new Error(`Missing OpenAPI operation description: ${key}`);
    pathItem[method].description = operationDescriptions[key];
  }
}

module.exports = swaggerJsdoc({ definition, apis: [] });
