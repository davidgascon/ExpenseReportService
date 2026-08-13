function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function attachUser(models) {
  return (req, res, next) => {
    if (req.session && req.session.userId) {
      const user = models.getUserById(req.session.userId);
      if (user) {
        req.user = user;
        res.locals.currentUser = user;
        return next();
      }
    }
    res.locals.currentUser = null;
    next();
  };
}

// Must run after attachUser/requireAuth so req.user is already set. Non-admin
// users get a plain 404 rather than a 403, so the admin dashboard's existence
// isn't advertised to regular users.
function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  return res.status(404).render('error', { message: 'Page not found.' });
}

module.exports = { requireAuth, attachUser, requireAdmin };
