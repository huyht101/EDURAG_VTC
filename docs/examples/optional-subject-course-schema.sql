-- OPTIONAL/LATER REFERENCE ONLY.
-- Do not run this file in the CURRENT/MVP bootstrap.
-- This is not a migration, not the canonical database contract, and not an
-- agreed NodeJS-Python contract.
--
-- Before implementation, the team must define:
-- - Teacher-subject relationships;
-- - document scoping;
-- - Student access;
-- - retrieval scope;
-- - the NodeJS-Python scope contract;
-- - a versioned migration for databases that already contain data.

CREATE TABLE `subjects` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `department` VARCHAR(150) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_subjects` PRIMARY KEY (`id`),
  CONSTRAINT `uq_subjects_code` UNIQUE (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `teacher_subjects` (
  `teacher_id` BIGINT UNSIGNED NOT NULL,
  `subject_id` INT UNSIGNED NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `pk_teacher_subjects` PRIMARY KEY (`teacher_id`, `subject_id`),
  CONSTRAINT `fk_teacher_subjects_teacher`
    FOREIGN KEY (`teacher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `fk_teacher_subjects_subject`
    FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
