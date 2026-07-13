const dashboardService = require('../services/dashboard-service');

async function summary(req, res, next) {
  try {
    return res.ok('OK', await dashboardService.summary(req.query));
  } catch (error) { return next(error); }
}

module.exports = { summary };
