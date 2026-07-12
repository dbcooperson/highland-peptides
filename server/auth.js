function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin login required.' });
  }
  next();
}

module.exports = { requireAdmin };
