ALTER TABLE `documents`
  ADD COLUMN `description` VARCHAR(2000) NULL DEFAULT NULL AFTER `title`,
  ADD COLUMN `author` VARCHAR(255) NULL DEFAULT NULL AFTER `description`,
  ADD COLUMN `page_count` INT UNSIGNED NULL DEFAULT NULL AFTER `checksum_sha256`,
  ADD COLUMN `preview_status` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING' AFTER `page_count`,
  ADD COLUMN `preview_storage_key` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL AFTER `preview_status`,
  ADD COLUMN `preview_mime_type` VARCHAR(127) CHARACTER SET ascii COLLATE ascii_general_ci NULL DEFAULT NULL AFTER `preview_storage_key`,
  ADD CONSTRAINT `chk_documents_page_count` CHECK (`page_count` IS NULL OR `page_count` > 0),
  ADD CONSTRAINT `chk_documents_preview_status` CHECK (`preview_status` IN ('PENDING','READY','FAILED','NOT_APPLICABLE'));

UPDATE `documents`
SET `preview_status` = CASE
      WHEN `file_type` = 'PDF' THEN 'READY'
      WHEN `file_type` = 'TXT' THEN 'NOT_APPLICABLE'
      ELSE 'PENDING'
    END,
    `preview_mime_type` = CASE
      WHEN `file_type` = 'PDF' THEN 'application/pdf'
      ELSE NULL
    END;

ALTER TABLE `document_processing_jobs`
  DROP CHECK `chk_processing_jobs_type`,
  ADD CONSTRAINT `chk_processing_jobs_type`
    CHECK (`job_type` IN ('INGEST','REPROCESS','SET_RETRIEVAL','DELETE_VECTORS','GENERATE_PDF_PREVIEW'));
