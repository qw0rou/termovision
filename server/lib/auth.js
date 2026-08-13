const crypto = require('crypto');
const db = require('../db');

/** Demo users seeded on first run. Passwords are SHA-256 (demo only; production should use bcrypt). */
const DEMO_USERS = [
  { id: 'u-admin', username: 'admin', password: 'admin123', name: 'Администратор', role_id: 'admin' },
  { id: 'u-dispatch', username: 'dispatcher', password: 'dispatcher123', name: 'Иванов Д.В.', role_id: 'dispatcher' },
  { id: 'u-field', username: 'field', password: 'field123', name: 'Бригада №1', role_id: 'field' }
];

function seedUsers() {
  for (const u of DEMO_USERS) {
    const hash = crypto.createHash('sha256').update(u.password).digest('hex');
    db.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,name,role_id,active) VALUES(?,?,?,?,?,1)').run(u.id, u.username, hash, u.name, u.role_id);
  }
}
seedUsers();

const sessions = new Map(); // token -> {userId, roleId, name, createdAt}

function createSession(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!user) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, roleId: user.role_id, name: user.name, username: user.username, createdAt: Date.now() });
  return { token, user: { id: user.id, username: user.username, name: user.name, roleId: user.role_id } };
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  return s;
}

function destroySession(token) { sessions.delete(token); }

function currentUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.cookies || {}).session || (req.query && req.query.session) || '';
  return getSession(token);
}

/** Permission check: role must have action in permissions.actions or '*' */
function hasPermission(user, action) {
  if (!user) return false;
  const row = db.prepare('SELECT actions FROM permissions WHERE role_id=?').get(user.roleId);
  if (!row) return false;
  let actions = [];
  try { actions = JSON.parse(row.actions); } catch (e) {}
  return actions.includes('*') || actions.includes(action);
}

function requirePermission(action) {
  return (req, res, next) => {
    const user = currentUser(req);
    const demo = (process.env.USE_MOCK_INTEGRATIONS || 'true') === 'true';
    if (demo && (!user || hasPermission(user, action))) return next();
    if (user && hasPermission(user, action)) return next();
    return res.status(403).json({ error: 'Недостаточно прав для выполнения операции' });
  };
}

/** Audit log: never throws. */
function logAudit(user, action, entityType, entityId, detail) {
  try {
    const id = 'audit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const userName = user ? user.name : 'Аноним';
    const userId = user ? user.userId : null;
    db.prepare('INSERT INTO audit_log(id,user_id,user_name,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, userId, userName, action, entityType || '', entityId || '', detail ? JSON.stringify(detail) : '', new Date().toISOString());
  } catch (e) { /* audit must never break the flow */ }
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if ((process.env.USE_MOCK_INTEGRATIONS || 'true') === 'true' && !user) {
    // Demo mode: auto-login as dispatcher so existing pages keep working
    const demo = createSession('u-dispatch');
    if (demo) req.user = demo.user;
    return next();
  }
  if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
  req.user = user;
  next();
}

function hashPassword(pw) { return crypto.createHash('sha256').update(String(pw)).digest('hex'); }

function verifyPassword(input, storedHash) { return hashPassword(input) === storedHash; }

module.exports = { createSession, getSession, destroySession, currentUser, hasPermission, requirePermission, requireAuth, logAudit, verifyPassword, hashPassword, DEMO_USERS };