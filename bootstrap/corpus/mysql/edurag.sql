-- EDURAG portable corpus: schema 1.0.0 + sanitized data
SET NAMES utf8mb4;

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `auth_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `token_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `used_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `attempt_count` tinyint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_tokens_hash` (`token_hash`),
  KEY `idx_auth_tokens_user_type_state` (`user_id`,`token_type`,`used_at`,`revoked_at`,`expires_at`),
  KEY `idx_auth_tokens_expiry` (`expires_at`),
  CONSTRAINT `fk_auth_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `chk_auth_tokens_type` CHECK ((`token_type` in (_utf8mb4'PASSWORD_RESET',_utf8mb4'ADMIN_OTP',_utf8mb4'EMAIL_VERIFICATION')))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Token một lần cho reset mật khẩu, Admin OTP và email verification.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` bigint unsigned NOT NULL,
  `sender_type` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `message_order` int unsigned NOT NULL,
  `content` mediumtext,
  `status` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'COMPLETED',
  `no_answer` tinyint(1) NOT NULL DEFAULT '0',
  `client_request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_chat_messages_session_order` (`session_id`,`message_order`),
  UNIQUE KEY `uq_chat_messages_client_request` (`client_request_id`),
  CONSTRAINT `fk_chat_messages_session` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_chat_messages_no_answer` CHECK (((`no_answer` in (false,true)) and ((`no_answer` = false) or (`sender_type` = _utf8mb4'ASSISTANT')))),
  CONSTRAINT `chk_chat_messages_order` CHECK ((`message_order` >= 1)),
  CONSTRAINT `chk_chat_messages_request_owner` CHECK (((`client_request_id` is null) or (`sender_type` = _utf8mb4'USER'))),
  CONSTRAINT `chk_chat_messages_sender` CHECK ((`sender_type` in (_utf8mb4'USER',_utf8mb4'ASSISTANT'))),
  CONSTRAINT `chk_chat_messages_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'COMPLETED',_utf8mb4'FAILED')))
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Message tuyến tính USER/ASSISTANT với thứ tự ổn định và trạng thái lỗi.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `last_message_at` datetime(3) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_chat_sessions_user_deleted_last` (`user_id`,`deleted_at`,`last_message_at`),
  CONSTRAINT `fk_chat_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Phiên hội thoại thuộc một user; soft delete bằng deleted_at.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `citations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `citations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `message_id` bigint unsigned NOT NULL,
  `document_id` bigint unsigned DEFAULT NULL,
  `chunk_id` bigint unsigned DEFAULT NULL,
  `vector_node_id_snapshot` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `citation_order` smallint unsigned NOT NULL,
  `document_title_snapshot` varchar(255) NOT NULL,
  `page_number_snapshot` int unsigned DEFAULT NULL,
  `section_title_snapshot` varchar(500) DEFAULT NULL,
  `source_text_snapshot` text NOT NULL,
  `source_locator_snapshot` json DEFAULT NULL,
  `retrieval_score` double DEFAULT NULL,
  `rerank_score` double DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_citations_message_order` (`message_id`,`citation_order`),
  KEY `idx_citations_document` (`document_id`),
  KEY `idx_citations_chunk` (`chunk_id`),
  CONSTRAINT `fk_citations_chunk` FOREIGN KEY (`chunk_id`) REFERENCES `document_chunks` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_citations_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_citations_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_citations_order` CHECK ((`citation_order` >= 1)),
  CONSTRAINT `chk_citations_page` CHECK (((`page_number_snapshot` is null) or (`page_number_snapshot` >= 1)))
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Snapshot bất biến của nguồn đã dùng cho một assistant message.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `document_chunks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `document_chunks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `document_id` bigint unsigned NOT NULL,
  `processing_job_id` bigint unsigned NOT NULL,
  `chunk_index` int unsigned NOT NULL,
  `vector_node_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `chunk_text` text NOT NULL,
  `content_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_count` int unsigned DEFAULT NULL,
  `page_number` int unsigned DEFAULT NULL,
  `section_title` varchar(500) DEFAULT NULL,
  `source_locator` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_chunks_doc_index` (`document_id`,`chunk_index`),
  UNIQUE KEY `uq_document_chunks_vector_node` (`vector_node_id`),
  KEY `idx_document_chunks_job` (`processing_job_id`),
  CONSTRAINT `fk_document_chunks_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_document_chunks_job` FOREIGN KEY (`processing_job_id`) REFERENCES `document_processing_jobs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_document_chunks_page` CHECK (((`page_number` is null) or (`page_number` >= 1))),
  CONSTRAINT `chk_document_chunks_token_count` CHECK (((`token_count` is null) or (`token_count` > 0)))
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Chunk source text và mapping trực tiếp tới LlamaIndex Node/Qdrant point.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `document_processing_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `document_processing_jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `document_id` bigint unsigned NOT NULL,
  `job_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'QUEUED',
  `current_stage` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `attempt_count` tinyint unsigned NOT NULL DEFAULT '0',
  `max_attempts` tinyint unsigned NOT NULL DEFAULT '3',
  `pipeline_version` varchar(50) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `parser_name` varchar(100) DEFAULT NULL,
  `embedding_model` varchar(150) DEFAULT NULL,
  `embedding_dimension` smallint unsigned DEFAULT NULL,
  `vector_collection` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `job_config` json DEFAULT NULL,
  `total_chunks` int unsigned DEFAULT NULL,
  `error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `error_message` varchar(2000) DEFAULT NULL,
  `started_at` datetime(3) DEFAULT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `callback_received_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_processing_jobs_document_created` (`document_id`,`created_at`),
  KEY `idx_processing_jobs_status_created` (`status`,`created_at`),
  CONSTRAINT `fk_processing_jobs_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_processing_jobs_attempts` CHECK (((`max_attempts` >= 1) and (`attempt_count` <= `max_attempts`))),
  CONSTRAINT `chk_processing_jobs_dimension` CHECK (((`embedding_dimension` is null) or (`embedding_dimension` > 0))),
  CONSTRAINT `chk_processing_jobs_status` CHECK ((`status` in (_utf8mb4'QUEUED',_utf8mb4'RUNNING',_utf8mb4'SUCCEEDED',_utf8mb4'FAILED',_utf8mb4'CANCELLED'))),
  CONSTRAINT `chk_processing_jobs_type` CHECK ((`job_type` in (_utf8mb4'INGEST',_utf8mb4'REPROCESS',_utf8mb4'SET_RETRIEVAL',_utf8mb4'DELETE_VECTORS')))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Một hàng cho mỗi tác vụ ingest/reprocess/đổi retrieval/xóa vector; không cần event-log riêng.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `documents` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `uploaded_by` bigint unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `original_filename` varchar(255) NOT NULL,
  `storage_type` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'LOCAL',
  `storage_key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `file_type` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `mime_type` varchar(127) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `file_size_bytes` bigint unsigned NOT NULL,
  `checksum_sha256` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `processing_status` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UPLOADED',
  `visibility_status` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'VISIBLE',
  `processed_at` datetime(3) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_documents_storage_key` (`storage_type`,`storage_key`),
  KEY `idx_documents_owner_visibility_created` (`uploaded_by`,`visibility_status`,`created_at`),
  KEY `idx_documents_rag_state_created` (`processing_status`,`visibility_status`,`created_at`),
  KEY `idx_documents_checksum` (`checksum_sha256`),
  CONSTRAINT `fk_documents_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_documents_deleted_timestamp` CHECK ((((`visibility_status` = _utf8mb4'DELETED') and (`deleted_at` is not null)) or ((`visibility_status` <> _utf8mb4'DELETED') and (`deleted_at` is null)))),
  CONSTRAINT `chk_documents_file_size` CHECK ((`file_size_bytes` > 0)),
  CONSTRAINT `chk_documents_file_type` CHECK ((`file_type` in (_utf8mb4'TXT',_utf8mb4'DOCX',_utf8mb4'PDF',_utf8mb4'PPTX'))),
  CONSTRAINT `chk_documents_processing_status` CHECK ((`processing_status` in (_utf8mb4'UPLOADED',_utf8mb4'PROCESSING',_utf8mb4'READY',_utf8mb4'FAILED',_utf8mb4'CANCELLED'))),
  CONSTRAINT `chk_documents_ready_timestamp` CHECK (((`processing_status` <> _utf8mb4'READY') or (`processed_at` is not null))),
  CONSTRAINT `chk_documents_storage_type` CHECK ((`storage_type` in (_utf8mb4'LOCAL',_utf8mb4'OBJECT'))),
  CONSTRAINT `chk_documents_visibility_status` CHECK ((`visibility_status` in (_utf8mb4'VISIBLE',_utf8mb4'HIDDEN',_utf8mb4'DELETED')))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Metadata nghiệp vụ và vị trí file gốc; không lưu nội dung vector.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `llm_usage_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `llm_usage_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned DEFAULT NULL,
  `message_id` bigint unsigned DEFAULT NULL,
  `request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `call_index` smallint unsigned NOT NULL DEFAULT '1',
  `operation_type` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider` varchar(50) NOT NULL,
  `model` varchar(150) NOT NULL,
  `prompt_tokens` int unsigned NOT NULL DEFAULT '0',
  `completion_tokens` int unsigned NOT NULL DEFAULT '0',
  `total_tokens` int unsigned GENERATED ALWAYS AS ((`prompt_tokens` + `completion_tokens`)) STORED NOT NULL,
  `estimated_cost` decimal(18,8) DEFAULT NULL,
  `currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USD',
  `latency_ms` int unsigned DEFAULT NULL,
  `status` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `error_code` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_llm_usage_request_call` (`request_id`,`call_index`),
  KEY `idx_llm_usage_message` (`message_id`),
  KEY `idx_llm_usage_user_created` (`user_id`,`created_at`),
  KEY `idx_llm_usage_created` (`created_at`),
  CONSTRAINT `fk_llm_usage_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_llm_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `chk_llm_usage_call_index` CHECK ((`call_index` >= 1)),
  CONSTRAINT `chk_llm_usage_cost` CHECK (((`estimated_cost` is null) or (`estimated_cost` >= 0))),
  CONSTRAINT `chk_llm_usage_operation` CHECK ((`operation_type` in (_utf8mb4'QUERY_REWRITE',_utf8mb4'ANSWER_GENERATION',_utf8mb4'REFINE',_utf8mb4'OTHER'))),
  CONSTRAINT `chk_llm_usage_status` CHECK ((`status` in (_utf8mb4'SUCCEEDED',_utf8mb4'FAILED')))
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Một hàng cho mỗi LLM call; nhiều hàng có thể thuộc cùng assistant message/RAG request.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` tinyint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` varchar(80) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Danh mục vai trò hệ thống; MVP seed STUDENT, TEACHER và ADMIN.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `student_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `student_profiles` (
  `user_id` bigint unsigned NOT NULL,
  `student_code` varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `date_of_birth` date NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uq_student_profiles_code` (`student_code`),
  CONSTRAINT `fk_student_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Thông tin chỉ dành cho sinh viên.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `teacher_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teacher_profiles` (
  `user_id` bigint unsigned NOT NULL,
  `academic_title` varchar(100) DEFAULT NULL,
  `degree` varchar(100) DEFAULT NULL,
  `department` varchar(150) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_teacher_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Thông tin chuyên môn tùy chọn của giảng viên.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `role_id` tinyint unsigned NOT NULL,
  `full_name` varchar(150) NOT NULL,
  `email` varchar(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `phone` varchar(20) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `status` varchar(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  `auth_version` int unsigned NOT NULL DEFAULT '1',
  `email_verified_at` datetime(3) DEFAULT NULL,
  `reviewed_by` bigint unsigned DEFAULT NULL,
  `reviewed_at` datetime(3) DEFAULT NULL,
  `review_note` varchar(500) DEFAULT NULL,
  `locked_by` bigint unsigned DEFAULT NULL,
  `locked_at` datetime(3) DEFAULT NULL,
  `lock_reason` varchar(500) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role_status_created` (`role_id`,`status`,`created_at`),
  KEY `idx_users_reviewed_by` (`reviewed_by`),
  KEY `idx_users_locked_by` (`locked_by`),
  CONSTRAINT `fk_users_locked_by` FOREIGN KEY (`locked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_users_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_users_auth_version` CHECK ((`auth_version` >= 1)),
  CONSTRAINT `chk_users_status` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'ACTIVE',_utf8mb4'LOCKED',_utf8mb4'REJECTED')))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Tài khoản đăng nhập, trạng thái duyệt/khóa và phiên bản vô hiệu hóa JWT.';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;



/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

/*!40000 ALTER TABLE `chat_messages` DISABLE KEYS */;
INSERT INTO `chat_messages` VALUES (1,1,'USER',1,'Oishi là thương hiệu thuộc quốc gia nào?','COMPLETED',0,'3fa85f64-5717-4562-b3fc-2c963f66afa6',NULL,'2026-07-17 09:29:07.669','2026-07-17 09:29:07.671','2026-07-17 09:29:07.671'),(2,1,'ASSISTANT',2,'Dựa vào thông tin từ tài liệu cung cấp, Oishi là một thương hiệu snack đa quốc gia của công ty Liwayway, một công ty được thành lập và có trụ sở chính tại **Philippines** [1].','COMPLETED',0,NULL,NULL,'2026-07-17 09:29:15.105','2026-07-17 09:29:07.672','2026-07-17 09:29:15.105'),(3,1,'USER',3,'Cơ sở đầu tiên của công ty Liwayway tại Việt Nam nằm ở đâu?','COMPLETED',0,'3fa85f64-5717-4562-b3fc-2c963f66afba',NULL,'2026-07-17 09:34:34.236','2026-07-17 09:34:34.237','2026-07-17 09:34:34.237'),(4,1,'ASSISTANT',4,'Dựa vào thông tin từ tài liệu cung cấp, cơ sở đầu tiên của công ty Liwayway tại Việt Nam được thành lập vào năm 1996 tại:\n\n* Thành phố Hồ Chí Minh [1].\n* Cụ thể, trụ sở được đặt tại Khu công nghiệp (KCN) Việt Nam - Singapore, Thuận An, Bình Dương [1].','COMPLETED',0,NULL,NULL,'2026-07-17 09:34:41.011','2026-07-17 09:34:34.238','2026-07-17 09:34:41.011'),(5,1,'USER',5,'Cơ sở dữ liệu là gì?','COMPLETED',0,'3fa85f64-5717-4562-b3fc-2c963f66afab',NULL,'2026-07-17 09:41:47.526','2026-07-17 09:41:47.526','2026-07-17 09:41:47.526'),(6,1,'ASSISTANT',6,'Dựa vào thông tin từ tài liệu được cung cấp, không tìm thấy thông tin để trả lời cho câu hỏi \"Cơ sở dữ liệu là gì?\".','COMPLETED',0,NULL,NULL,'2026-07-17 09:41:53.383','2026-07-17 09:41:47.527','2026-07-17 09:41:53.383');
/*!40000 ALTER TABLE `chat_messages` ENABLE KEYS */;

/*!40000 ALTER TABLE `chat_sessions` DISABLE KEYS */;
INSERT INTO `chat_sessions` VALUES (1,1,'chatOishi','2026-07-17 09:41:53.386',NULL,'2026-07-17 09:24:55.622','2026-07-17 09:41:53.386');
/*!40000 ALTER TABLE `chat_sessions` ENABLE KEYS */;

/*!40000 ALTER TABLE `citations` DISABLE KEYS */;
INSERT INTO `citations` VALUES (1,2,1,1,'9589059b-c74b-40b8-896a-47aa77ed4601',1,'Lich su phat trien linh vat Oishi',1,NULL,'# I. Lịch sử phát triển\n\nOishi là 1 thương hiệu snack đa quốc gia của công ty Liwayway. Công ty này được thành lập vào năm 1946 ở Philippines và năm 1974 đã cho ra đời snack TômOishi đầu tiên. Cở sở V',NULL,NULL,NULL,'2026-07-17 09:29:15.108'),(2,4,1,1,'9589059b-c74b-40b8-896a-47aa77ed4601',1,'Lich su phat trien linh vat Oishi',1,NULL,'# I. Lịch sử phát triển\n\nOishi là 1 thương hiệu snack đa quốc gia của công ty Liwayway. Công ty này được thành lập vào năm 1946 ở Philippines và năm 1974 đã cho ra đời snack TômOishi đầu tiên. Cở sở V',NULL,NULL,NULL,'2026-07-17 09:34:41.012');
/*!40000 ALTER TABLE `citations` ENABLE KEYS */;

/*!40000 ALTER TABLE `document_chunks` DISABLE KEYS */;
INSERT INTO `document_chunks` VALUES (1,1,1,0,'9589059b-c74b-40b8-896a-47aa77ed4601','# I. Lịch sử phát triển\n\nOishi là 1 thương hiệu snack đa quốc gia của công ty Liwayway. Công ty này được thành lập vào năm 1946 ở Philippines và năm 1974 đã cho ra đời snack TômOishi đầu tiên. Cở sở Việt Nam đầu tiên của công ty được thành lập vào năm 1996 ở HCM. Từ đó công ty liên tiếp phát triển cho ra đời nhiều dòng sản phẩm bánh kẹo và đến nay đã có tổng cộng ít nhất 4 nhà máy ở các thành phố lớn như Hà Nội, Đà Nẵng, HCM.\n\n- 1946: công ty Liwayway được thành lập trụ sở chính tại Philippines.\n- 1974: Liwayway ra đời sản phẩm snack TômOishi dựa vào công nghệ snack hiện đại Nhật Bản.\n- 1996: Thành lập TNHH CNTP LIWAYWAY đặt trụ sở tại Hồ Chí Minh (KCN Việt Nam - Singapore, Thuận An, Bình Dương).\n- 2004: Mở rộng sản xuất sang dòng sản phẩm kẹo.\n- 2005: Tiếp tục phát triển thêm snack nhân đậu phộng.\n- 2007: Nhà máy thứ 2 tại Hà Nội đi vào hoạt động.\n- 2008: Đổi tên thành Công ty Cổ Phần Liwayway Việt Nam.\n- 2009: Nhà máy thứ 3 đặt tại HCM (KCN Việt Nam – Singapore) đi vào hoạt động.\n- 2011: Mở rộng sang thị trường bánh quy.','e7600f3da27237e68019ee627b32f0e059824b52f2d38f2bbe01ad9388ad1cf0',226,1,NULL,NULL,'2026-07-17 09:21:30.809'),(2,1,1,1,'f0f711be-2edc-4d99-96f5-c6c7f533fd81','- 2011: Mở rộng sang thị trường bánh quy.\n- 2013: Chính thức hoạt động nhà máy tại Đà Nẵng.\n- 2014: Ra mắt dòng thức uống đóng chai.\n- Hiện nay: Oishi đã có nhiều dòng sản phẩm bánh kẹo, là thương hiệu quen thuộc, chiếm vị trí cao trong lòng người tiêu dùng Việt Nam.\n\n# II. Linh vật (Chú Chim Oishi)\n\n***) Đã tìm hiểu và xác định là chim Cuckoo, cụ hơn xem ảnh dướ Ả i ( NH 3)\n\n- Là hình ảnh chú chim cuckoo màu vàng luôn đi kèm những snack oishi mà bạn thưởng thức.\n- Gợi lên những sở thích, ký ức thửa nhỏ và cảm giác thèm ăn.\n- Đã có Mascot áo đỏ sinh động từng được sử dụng trong sự kiện ở TP HCM.','1f43e91674b62e74dc68a525eb44e58a768ccc42056bbe51b570163612431804',136,1,NULL,NULL,'2026-07-17 09:21:30.812');
/*!40000 ALTER TABLE `document_chunks` ENABLE KEYS */;

/*!40000 ALTER TABLE `document_processing_jobs` DISABLE KEYS */;
INSERT INTO `document_processing_jobs` VALUES (1,1,'INGEST','SUCCEEDED','COMPLETED',1,3,NULL,NULL,NULL,NULL,NULL,NULL,2,NULL,NULL,'2026-07-17 09:21:10.084','2026-07-17 09:21:30.815','2026-07-17 09:21:30.815','2026-07-17 09:21:10.072','2026-07-17 09:21:30.815');
/*!40000 ALTER TABLE `document_processing_jobs` ENABLE KEYS */;

/*!40000 ALTER TABLE `documents` DISABLE KEYS */;
INSERT INTO `documents` VALUES (1,1,'Lich su phat trien linh vat Oishi','Lich su PT vÃ  Linh vat.pdf','LOCAL','documents/2026/07/a41fec0f-670a-408b-a541-a6377f6f96c2.pdf','PDF','application/pdf',4015027,'5309194ee4c531b914258094fec5ba80c730dd423a56841dd4baf069eefd47b0','READY','VISIBLE','2026-07-17 09:21:30.815',NULL,'2026-07-17 09:21:10.064','2026-07-17 09:21:30.816');
/*!40000 ALTER TABLE `documents` ENABLE KEYS */;

/*!40000 ALTER TABLE `llm_usage_logs` DISABLE KEYS */;
INSERT INTO `llm_usage_logs` (`id`, `user_id`, `message_id`, `request_id`, `call_index`, `operation_type`, `provider`, `model`, `prompt_tokens`, `completion_tokens`, `estimated_cost`, `currency`, `latency_ms`, `status`, `error_code`, `created_at`) VALUES (1,1,2,'3fa85f64-5717-4562-b3fc-2c963f66afa6',1,'ANSWER_GENERATION','GOOGLE','models/gemini-3.5-flash',0,0,NULL,'USD',NULL,'SUCCEEDED',NULL,'2026-07-17 09:29:15.110'),(2,1,4,'3fa85f64-5717-4562-b3fc-2c963f66afba',1,'ANSWER_GENERATION','GOOGLE','models/gemini-3.5-flash',0,0,NULL,'USD',NULL,'SUCCEEDED',NULL,'2026-07-17 09:34:41.014'),(3,1,6,'3fa85f64-5717-4562-b3fc-2c963f66afab',1,'ANSWER_GENERATION','GOOGLE','models/gemini-3.5-flash',0,0,NULL,'USD',NULL,'SUCCEEDED',NULL,'2026-07-17 09:41:53.385');
/*!40000 ALTER TABLE `llm_usage_logs` ENABLE KEYS */;

/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (1,'STUDENT','Sinh viên','Hỏi đáp RAG và xem citation/source','2026-07-17 09:17:10.138','2026-07-17 09:17:10.138'),(2,'TEACHER','Giảng viên','Quyền Sinh viên và quản lý tài liệu do mình upload','2026-07-17 09:17:10.138','2026-07-17 09:17:10.138'),(3,'ADMIN','Quản trị viên','Quản lý tài khoản, toàn bộ tài liệu và dashboard','2026-07-17 09:17:10.138','2026-07-17 09:17:10.138');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;

/*!40000 ALTER TABLE `student_profiles` DISABLE KEYS */;
/*!40000 ALTER TABLE `student_profiles` ENABLE KEYS */;

/*!40000 ALTER TABLE `teacher_profiles` DISABLE KEYS */;
/*!40000 ALTER TABLE `teacher_profiles` ENABLE KEYS */;

/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,3,'Demo Administrator','admin@example.com','$2b$12$bMzMUHcWiX7.t.YAVHaFq.nMbxN/zHbowX3kWo/jH2Q2esR/o8I8K',NULL,'ACTIVE',1,'2026-07-17 09:17:10.182',NULL,NULL,NULL,NULL,NULL,NULL,'2026-07-17 09:17:10.182','2026-07-17 09:17:10.182');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

