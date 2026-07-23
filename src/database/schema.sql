-- EduRAG MVP database schema
-- Schema version: 1.0.0
-- Target: MySQL 8.4 LTS, InnoDB, UTC timestamps
-- Generated: 2026-07-11
-- This script is non-destructive: it does not DROP existing objects.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS `edurag`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE `edurag`;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_roles` PRIMARY KEY (`id`),
  CONSTRAINT `uq_roles_code` UNIQUE (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Danh mục vai trò hệ thống; MVP seed STUDENT, TEACHER và ADMIN.';

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` TINYINT UNSIGNED NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_general_ci NULL DEFAULT NULL,
  `status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  `auth_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `email_verified_at` DATETIME(3) NULL DEFAULT NULL,
  `reviewed_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `reviewed_at` DATETIME(3) NULL DEFAULT NULL,
  `review_note` VARCHAR(500) NULL DEFAULT NULL,
  `locked_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `locked_at` DATETIME(3) NULL DEFAULT NULL,
  `lock_reason` VARCHAR(500) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_users` PRIMARY KEY (`id`),
  CONSTRAINT `uq_users_email` UNIQUE (`email`),
  KEY `idx_users_role_status_created` (`role_id`, `status`, `created_at`),
  KEY `idx_users_reviewed_by` (`reviewed_by`),
  KEY `idx_users_locked_by` (`locked_by`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_users_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_users_locked_by` FOREIGN KEY (`locked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `chk_users_status` CHECK (status IN ('PENDING','ACTIVE','LOCKED','REJECTED')),
  CONSTRAINT `chk_users_auth_version` CHECK (auth_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Tài khoản đăng nhập, trạng thái duyệt/khóa và phiên bản vô hiệu hóa JWT.';

CREATE TABLE IF NOT EXISTS `student_profiles` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `date_of_birth` DATE NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_student_profiles` PRIMARY KEY (`user_id`),
  CONSTRAINT `uq_student_profiles_code` UNIQUE (`student_code`),
  CONSTRAINT `fk_student_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Thông tin chỉ dành cho sinh viên.';

CREATE TABLE IF NOT EXISTS `teacher_profiles` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `academic_title` VARCHAR(100) NULL DEFAULT NULL,
  `degree` VARCHAR(100) NULL DEFAULT NULL,
  `department` VARCHAR(150) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_teacher_profiles` PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_teacher_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Thông tin chuyên môn tùy chọn của giảng viên.';

CREATE TABLE IF NOT EXISTS `auth_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL DEFAULT NULL,
  `revoked_at` DATETIME(3) NULL DEFAULT NULL,
  `attempt_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_auth_tokens` PRIMARY KEY (`id`),
  CONSTRAINT `uq_auth_tokens_hash` UNIQUE (`token_hash`),
  KEY `idx_auth_tokens_user_type_state` (`user_id`, `token_type`, `used_at`, `revoked_at`, `expires_at`),
  KEY `idx_auth_tokens_expiry` (`expires_at`),
  CONSTRAINT `fk_auth_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `chk_auth_tokens_type` CHECK (token_type IN ('PASSWORD_RESET','ADMIN_OTP','EMAIL_VERIFICATION'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Token một lần cho reset mật khẩu, Admin OTP và email verification.';

CREATE TABLE IF NOT EXISTS `documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uploaded_by` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `storage_type` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'LOCAL',
  `storage_key` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `file_type` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `mime_type` VARCHAR(127) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `file_size_bytes` BIGINT UNSIGNED NOT NULL,
  `checksum_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `processing_status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UPLOADED',
  `visibility_status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'VISIBLE',
  `processed_at` DATETIME(3) NULL DEFAULT NULL,
  `deleted_at` DATETIME(3) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_documents` PRIMARY KEY (`id`),
  CONSTRAINT `uq_documents_storage_key` UNIQUE (`storage_type`, `storage_key`),
  KEY `idx_documents_owner_visibility_created` (`uploaded_by`, `visibility_status`, `created_at`),
  KEY `idx_documents_rag_state_created` (`processing_status`, `visibility_status`, `created_at`),
  KEY `idx_documents_checksum` (`checksum_sha256`),
  CONSTRAINT `fk_documents_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_documents_storage_type` CHECK (storage_type IN ('LOCAL','OBJECT')),
  CONSTRAINT `chk_documents_file_type` CHECK (file_type IN ('TXT','DOCX','PDF','PPTX')),
  CONSTRAINT `chk_documents_processing_status` CHECK (processing_status IN ('UPLOADED','PROCESSING','READY','FAILED','CANCELLED')),
  CONSTRAINT `chk_documents_visibility_status` CHECK (visibility_status IN ('VISIBLE','HIDDEN','DELETED')),
  CONSTRAINT `chk_documents_file_size` CHECK (file_size_bytes > 0),
  CONSTRAINT `chk_documents_ready_timestamp` CHECK (processing_status <> 'READY' OR processed_at IS NOT NULL),
  CONSTRAINT `chk_documents_deleted_timestamp` CHECK ((visibility_status = 'DELETED' AND deleted_at IS NOT NULL) OR (visibility_status <> 'DELETED' AND deleted_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Metadata nghiệp vụ và vị trí file gốc; không lưu nội dung vector.';

CREATE TABLE IF NOT EXISTS `document_processing_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `document_id` BIGINT UNSIGNED NOT NULL,
  `job_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'QUEUED',
  `current_stage` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `attempt_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 3,
  `pipeline_version` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `parser_name` VARCHAR(100) NULL DEFAULT NULL,
  `embedding_model` VARCHAR(150) NULL DEFAULT NULL,
  `embedding_dimension` SMALLINT UNSIGNED NULL DEFAULT NULL,
  `vector_collection` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `job_config` JSON NULL DEFAULT NULL,
  `total_chunks` INT UNSIGNED NULL DEFAULT NULL,
  `error_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `error_message` VARCHAR(2000) NULL DEFAULT NULL,
  `started_at` DATETIME(3) NULL DEFAULT NULL,
  `finished_at` DATETIME(3) NULL DEFAULT NULL,
  `callback_received_at` DATETIME(3) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_document_processing_jobs` PRIMARY KEY (`id`),
  KEY `idx_processing_jobs_document_created` (`document_id`, `created_at`),
  KEY `idx_processing_jobs_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_processing_jobs_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_processing_jobs_type` CHECK (job_type IN ('INGEST','REPROCESS','SET_RETRIEVAL','DELETE_VECTORS')),
  CONSTRAINT `chk_processing_jobs_status` CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT `chk_processing_jobs_attempts` CHECK (max_attempts >= 1 AND attempt_count <= max_attempts),
  CONSTRAINT `chk_processing_jobs_dimension` CHECK (embedding_dimension IS NULL OR embedding_dimension > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Một hàng cho mỗi tác vụ ingest/reprocess/đổi retrieval/xóa vector; không cần event-log riêng.';

CREATE TABLE IF NOT EXISTS `document_chunks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `document_id` BIGINT UNSIGNED NOT NULL,
  `processing_job_id` BIGINT UNSIGNED NOT NULL,
  `chunk_index` INT UNSIGNED NOT NULL,
  `vector_node_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `chunk_text` TEXT NOT NULL,
  `content_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_count` INT UNSIGNED NULL DEFAULT NULL,
  `page_number` INT UNSIGNED NULL DEFAULT NULL,
  `section_title` VARCHAR(500) NULL DEFAULT NULL,
  `source_locator` JSON NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_document_chunks` PRIMARY KEY (`id`),
  CONSTRAINT `uq_document_chunks_doc_index` UNIQUE (`document_id`, `chunk_index`),
  CONSTRAINT `uq_document_chunks_vector_node` UNIQUE (`vector_node_id`),
  KEY `idx_document_chunks_job` (`processing_job_id`),
  CONSTRAINT `fk_document_chunks_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_document_chunks_job` FOREIGN KEY (`processing_job_id`) REFERENCES `document_processing_jobs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_document_chunks_page` CHECK (page_number IS NULL OR page_number >= 1),
  CONSTRAINT `chk_document_chunks_token_count` CHECK (token_count IS NULL OR token_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Chunk source text và mapping trực tiếp tới LlamaIndex Node/Qdrant point.';

CREATE TABLE IF NOT EXISTS `chat_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NULL DEFAULT NULL,
  `last_message_at` DATETIME(3) NULL DEFAULT NULL,
  `deleted_at` DATETIME(3) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_chat_sessions` PRIMARY KEY (`id`),
  KEY `idx_chat_sessions_user_deleted_last` (`user_id`, `deleted_at`, `last_message_at`),
  CONSTRAINT `fk_chat_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Phiên hội thoại thuộc một user; soft delete bằng deleted_at.';

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `sender_type` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `message_order` INT UNSIGNED NOT NULL,
  `content` MEDIUMTEXT NULL DEFAULT NULL,
  `status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'COMPLETED',
  `no_answer` BOOLEAN NOT NULL DEFAULT FALSE,
  `client_request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `error_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `completed_at` DATETIME(3) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_chat_messages` PRIMARY KEY (`id`),
  CONSTRAINT `uq_chat_messages_session_order` UNIQUE (`session_id`, `message_order`),
  CONSTRAINT `uq_chat_messages_client_request` UNIQUE (`client_request_id`),
  CONSTRAINT `fk_chat_messages_session` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_chat_messages_sender` CHECK (sender_type IN ('USER','ASSISTANT')),
  CONSTRAINT `chk_chat_messages_status` CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  CONSTRAINT `chk_chat_messages_order` CHECK (message_order >= 1),
  CONSTRAINT `chk_chat_messages_no_answer` CHECK (no_answer IN (FALSE, TRUE) AND (no_answer = FALSE OR sender_type = 'ASSISTANT')),
  CONSTRAINT `chk_chat_messages_request_owner` CHECK (client_request_id IS NULL OR sender_type = 'USER')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Message tuyến tính USER/ASSISTANT với thứ tự ổn định và trạng thái lỗi.';

CREATE TABLE IF NOT EXISTS `citations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `message_id` BIGINT UNSIGNED NOT NULL,
  `document_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `chunk_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `vector_node_id_snapshot` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `citation_order` SMALLINT UNSIGNED NOT NULL,
  `document_title_snapshot` VARCHAR(255) NOT NULL,
  `page_number_snapshot` INT UNSIGNED NULL DEFAULT NULL,
  `section_title_snapshot` VARCHAR(500) NULL DEFAULT NULL,
  `source_text_snapshot` TEXT NOT NULL,
  `source_locator_snapshot` JSON NULL DEFAULT NULL,
  `retrieval_score` DOUBLE NULL DEFAULT NULL,
  `rerank_score` DOUBLE NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_citations` PRIMARY KEY (`id`),
  CONSTRAINT `uq_citations_message_order` UNIQUE (`message_id`, `citation_order`),
  KEY `idx_citations_document` (`document_id`),
  KEY `idx_citations_chunk` (`chunk_id`),
  CONSTRAINT `fk_citations_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_citations_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_citations_chunk` FOREIGN KEY (`chunk_id`) REFERENCES `document_chunks` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `chk_citations_order` CHECK (citation_order >= 1),
  CONSTRAINT `chk_citations_page` CHECK (page_number_snapshot IS NULL OR page_number_snapshot >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Snapshot bất biến của nguồn đã dùng cho một assistant message.';

CREATE TABLE IF NOT EXISTS `llm_usage_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `message_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `call_index` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `operation_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `model` VARCHAR(150) NOT NULL,
  `prompt_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
  `completion_tokens` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_tokens` INT UNSIGNED GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED NOT NULL,
  `estimated_cost` DECIMAL(18,8) NULL DEFAULT NULL,
  `currency` CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USD',
  `latency_ms` INT UNSIGNED NULL DEFAULT NULL,
  `status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `error_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_llm_usage_logs` PRIMARY KEY (`id`),
  CONSTRAINT `uq_llm_usage_request_call` UNIQUE (`request_id`, `call_index`),
  KEY `idx_llm_usage_message` (`message_id`),
  KEY `idx_llm_usage_user_created` (`user_id`, `created_at`),
  KEY `idx_llm_usage_created` (`created_at`),
  CONSTRAINT `fk_llm_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_llm_usage_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `chk_llm_usage_call_index` CHECK (call_index >= 1),
  CONSTRAINT `chk_llm_usage_operation` CHECK (operation_type IN ('QUERY_REWRITE','ANSWER_GENERATION','REFINE','OTHER')),
  CONSTRAINT `chk_llm_usage_status` CHECK (status IN ('SUCCEEDED','FAILED')),
  CONSTRAINT `chk_llm_usage_cost` CHECK (estimated_cost IS NULL OR estimated_cost >= 0)
CREATE TABLE IF NOT EXISTS `subjects` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `department` VARCHAR(150) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_subjects` PRIMARY KEY (`id`),
  CONSTRAINT `uq_subjects_code` UNIQUE (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Danh mục Môn học hệ thống.';

CREATE TABLE IF NOT EXISTS `teacher_subjects` (
  `teacher_id` BIGINT UNSIGNED NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_teacher_subjects` PRIMARY KEY (`teacher_id`, `subject_id`),
  CONSTRAINT `fk_teacher_subjects_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_teacher_subjects_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Phân quyền Môn học được quản lý cho Giảng viên.';

START TRANSACTION;

INSERT INTO `roles` (`id`, `code`, `name`, `description`) VALUES
  (1, 'STUDENT', 'Sinh viên', 'Hỏi đáp RAG và xem citation/source'),
  (2, 'TEACHER', 'Giảng viên', 'Quyền Sinh viên và quản lý tài liệu do mình upload'),
  (3, 'ADMIN', 'Quản trị viên', 'Quản lý tài khoản, toàn bộ tài liệu và dashboard')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`);

COMMIT;
