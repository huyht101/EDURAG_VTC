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
    version: '1.0.0-compatibility-gate',
    description: 'Part 1 APIs thực sự đã triển khai. Document/Chat/Citation/Dashboard chưa được triển khai.'
  },
  servers: [{ url: 'http://localhost:5000' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
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
    }
  }
};

module.exports = swaggerJsdoc({ definition, apis: [] });
