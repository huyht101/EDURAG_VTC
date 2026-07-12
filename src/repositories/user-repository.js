const pool = require('../configs/db');

function executorOrPool(executor) {
  return executor || pool;
}

async function findUserByEmail(email, executor) {
  const [rows] = await executorOrPool(executor).execute(
    `SELECT u.id, u.role_id, u.full_name, u.email, u.password_hash, u.status,
            u.auth_version, r.code AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE u.email = ?`,
    [email]
  );
  return rows[0] || null;
}

async function findAuthUserById(id, executor) {
  const [rows] = await executorOrPool(executor).execute(
    `SELECT u.id, u.email, u.status, u.auth_version, r.code AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE u.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findUserById(id, executor) {
  const [rows] = await executorOrPool(executor).execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status,
            u.reviewed_by, u.reviewed_at, u.review_note,
            u.locked_by, u.locked_at, u.lock_reason,
            u.created_at, u.updated_at, r.code AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE u.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findUserByIdForUpdate(id, executor) {
  const [rows] = await executorOrPool(executor).execute(
    `SELECT u.id, u.status, u.auth_version, r.code AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     WHERE u.id = ?
     FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
}

async function findProfileDetail(id, role, executor) {
  let sql;
  if (role === 'STUDENT') {
    sql = `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
                  r.code AS role, sp.student_code, sp.date_of_birth
           FROM users u
           JOIN roles r ON u.role_id = r.id
           LEFT JOIN student_profiles sp ON sp.user_id = u.id
           WHERE u.id = ?`;
  } else if (role === 'TEACHER') {
    sql = `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
                  r.code AS role, tp.academic_title, tp.degree, tp.department
           FROM users u
           JOIN roles r ON u.role_id = r.id
           LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
           WHERE u.id = ?`;
  } else {
    sql = `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
                  r.code AS role
           FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE u.id = ?`;
  }

  const [rows] = await executorOrPool(executor).execute(sql, [id]);
  return rows[0] || null;
}

async function checkDuplicate({ email, studentCode }, executor) {
  const db = executorOrPool(executor);
  if (studentCode) {
    const [rows] = await db.execute(
      `SELECT u.id
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.email = ? OR sp.student_code = ?`,
      [email, studentCode]
    );
    return rows.length > 0;
  }
  const [rows] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
  return rows.length > 0;
}

async function listUsers({ page = 1, limit = 10, search = '', role = '', status = '' }, executor) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1 = 1';

  if (search) {
    where += ' AND (u.full_name LIKE ? OR u.email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (role) {
    where += ' AND r.code = ?';
    params.push(role);
  }
  if (status) {
    where += ' AND u.status = ?';
    params.push(status);
  }

  const db = executorOrPool(executor);
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM users u JOIN roles r ON u.role_id = r.id ${where}`,
    params
  );
  const [dataRows] = await db.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
            r.code AS role
     FROM users u
     JOIN roles r ON u.role_id = r.id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { total: countRows[0].total, users: dataRows };
}

async function createUser({ roleId, fullName, email, passwordHash, phone = null, status }, executor) {
  const [result] = await executorOrPool(executor).execute(
    `INSERT INTO users (role_id, full_name, email, password_hash, phone, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [roleId, fullName, email, passwordHash, phone, status]
  );
  return result.insertId;
}

async function createStudentProfile({ userId, studentCode, dateOfBirth }, executor) {
  await executorOrPool(executor).execute(
    'INSERT INTO student_profiles (user_id, student_code, date_of_birth) VALUES (?, ?, ?)',
    [userId, studentCode, dateOfBirth]
  );
}

async function createTeacherProfile({ userId, academicTitle = null, degree = null, department = null }, executor) {
  await executorOrPool(executor).execute(
    'INSERT INTO teacher_profiles (user_id, academic_title, degree, department) VALUES (?, ?, ?, ?)',
    [userId, academicTitle, degree, department]
  );
}

async function updateBasicInfo(id, { fullName, phone }, executor) {
  await executorOrPool(executor).execute(
    'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
    [fullName, phone, id]
  );
}

async function updateStudentProfile(userId, { dateOfBirth }, executor) {
  await executorOrPool(executor).execute(
    'UPDATE student_profiles SET date_of_birth = ? WHERE user_id = ?',
    [dateOfBirth, userId]
  );
}

async function updateTeacherProfile(userId, { academicTitle, degree, department }, executor) {
  await executorOrPool(executor).execute(
    `UPDATE teacher_profiles
     SET academic_title = ?, degree = ?, department = ?
     WHERE user_id = ?`,
    [academicTitle, degree, department, userId]
  );
}

async function findPasswordHashById(id, executor, forUpdate = false) {
  const [rows] = await executorOrPool(executor).execute(
    `SELECT password_hash FROM users WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0]?.password_hash || null;
}

async function updatePasswordAndIncrementVersion(id, passwordHash, executor) {
  await executorOrPool(executor).execute(
    'UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?',
    [passwordHash, id]
  );
}

async function reviewTeacher(id, status, adminId, reviewNote, executor) {
  await executorOrPool(executor).execute(
    `UPDATE users
     SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_note = ?
     WHERE id = ?`,
    [status, adminId, reviewNote, id]
  );
}

async function reopenTeacherReview(id, executor) {
  await executorOrPool(executor).execute(
    "UPDATE users SET status = 'PENDING' WHERE id = ?",
    [id]
  );
}

async function lockUser(id, adminId, reason, executor) {
  await executorOrPool(executor).execute(
    `UPDATE users
     SET status = 'LOCKED', locked_by = ?, locked_at = CURRENT_TIMESTAMP(3),
         lock_reason = ?, auth_version = auth_version + 1
     WHERE id = ?`,
    [adminId, reason, id]
  );
}

async function unlockUser(id, executor) {
  await executorOrPool(executor).execute(
    "UPDATE users SET status = 'ACTIVE' WHERE id = ?",
    [id]
  );
}

async function findRoleByCode(code, executor) {
  const [rows] = await executorOrPool(executor).execute(
    'SELECT id FROM roles WHERE code = ?',
    [code]
  );
  return rows[0] || null;
}

module.exports = {
  findUserByEmail,
  findAuthUserById,
  findUserById,
  findUserByIdForUpdate,
  findProfileDetail,
  checkDuplicate,
  listUsers,
  createUser,
  createStudentProfile,
  createTeacherProfile,
  updateBasicInfo,
  updateStudentProfile,
  updateTeacherProfile,
  findPasswordHashById,
  updatePasswordAndIncrementVersion,
  reviewTeacher,
  reopenTeacherReview,
  lockUser,
  unlockUser,
  findRoleByCode
};
