# Account and authentication dictionary

## `roles`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | TINYINT UNSIGNED, auto | PK | Role identifier |
| `code` | VARCHAR(32), required | UNIQUE | `STUDENT`, `TEACHER`, `ADMIN` |
| `name` | VARCHAR(80), required | — | Display name |
| `description` | VARCHAR(255), nullable | — | Short description |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | — | Audit timestamps |

Seed role dùng upsert theo `code`; application không hard-code role ID.

## `users`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | User identifier |
| `role_id` | TINYINT UNSIGNED, required | FK `roles.id`; composite index | Một role/user |
| `full_name` | VARCHAR(150), required | — | Display name |
| `email` | VARCHAR(254), required | UNIQUE, case-insensitive ASCII | Normalized login email |
| `password_hash` | VARCHAR(255), required | — | Bcrypt hash |
| `phone` | VARCHAR(20), nullable | — | Optional phone |
| `status` | VARCHAR(20), default `PENDING` | role/status/created index | `PENDING`, `ACTIVE`, `LOCKED`, `REJECTED` |
| `auth_version` | INT UNSIGNED, default 1 | CHECK `>=1` | JWT global invalidation version |
| `email_verified_at` | DATETIME(3), nullable | — | Email verification time |
| `reviewed_by` | BIGINT UNSIGNED, nullable | FK `users.id`, index | Last review Admin |
| `reviewed_at` | DATETIME(3), nullable | — | Last review time |
| `review_note` | VARCHAR(500), nullable | — | Review/rejection note |
| `locked_by` | BIGINT UNSIGNED, nullable | FK `users.id`, index | Last lock Admin |
| `locked_at` | DATETIME(3), nullable | — | Last lock time |
| `lock_reason` | VARCHAR(500), nullable | — | Last lock reason |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | created in composite index | Audit timestamps |

Review/lock actor FK uses `ON DELETE SET NULL`. Student registration creates `ACTIVE`; Teacher registration creates `PENDING`. Lock/password change/reset increments `auth_version`.

## `student_profiles`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `user_id` | BIGINT UNSIGNED, required | PK, FK `users.id` CASCADE | Student user |
| `student_code` | VARCHAR(32), required | UNIQUE | Immutable student code |
| `date_of_birth` | DATE, required | — | Date of birth |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | — | Audit timestamps |

## `teacher_profiles`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `user_id` | BIGINT UNSIGNED, required | PK, FK `users.id` CASCADE | Teacher user |
| `academic_title` | VARCHAR(100), nullable | — | Academic title |
| `degree` | VARCHAR(100), nullable | — | Degree |
| `department` | VARCHAR(150), nullable | — | Department text in MVP |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | — | Audit timestamps |

Không có `teacher_code`.

## `auth_tokens`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Token row |
| `user_id` | BIGINT UNSIGNED, required | FK `users.id` CASCADE; state index | Owner |
| `token_type` | VARCHAR(32), required | state index, CHECK | `PASSWORD_RESET`, `ADMIN_OTP`, `EMAIL_VERIFICATION` |
| `token_hash` | CHAR(64), required | UNIQUE | HMAC/SHA-256 hex digest; never plaintext |
| `expires_at` | DATETIME(3), required | state/expiry indexes | Expiry UTC |
| `used_at` | DATETIME(3), nullable | state index | Successful use |
| `revoked_at` | DATETIME(3), nullable | state index | Revoked/attempt limit |
| `attempt_count` | TINYINT UNSIGNED, default 0 | — | Failed verification count |
| `created_at` | DATETIME(3), auto UTC | — | Issue time |
