ALTER TABLE `users`
  ADD COLUMN `avatar_storage_key` VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL AFTER `phone`,
  ADD COLUMN `avatar_mime_type` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL DEFAULT NULL AFTER `avatar_storage_key`,
  ADD CONSTRAINT `chk_users_avatar_pair` CHECK (
    (`avatar_storage_key` IS NULL AND `avatar_mime_type` IS NULL)
    OR (`avatar_storage_key` IS NOT NULL AND `avatar_mime_type` IS NOT NULL)
  ),
  ADD CONSTRAINT `chk_users_avatar_mime` CHECK (
    `avatar_mime_type` IS NULL OR `avatar_mime_type` IN ('image/jpeg','image/png','image/webp')
  );
