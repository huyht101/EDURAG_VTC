-- EduRAG local/demo data only.
-- DEMO ONLY: never reuse these credentials in production.
-- Demo Admin login: admin@example.com / 123456
-- password_hash below is a bcrypt hash of the demo password, never plaintext.

USE `edurag`;

START TRANSACTION;

INSERT INTO `users` (
  `role_id`,
  `full_name`,
  `email`,
  `password_hash`,
  `status`,
  `auth_version`,
  `email_verified_at`
)
SELECT
  r.`id`,
  'Demo Administrator',
  'admin@example.com',
  '$2b$12$bMzMUHcWiX7.t.YAVHaFq.nMbxN/zHbowX3kWo/jH2Q2esR/o8I8K',
  'ACTIVE',
  1,
  CURRENT_TIMESTAMP(3)
FROM `roles` r
WHERE r.`code` = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `users` u WHERE u.`email` = 'admin@example.com'
  );

COMMIT;
