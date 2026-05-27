const prisma = require('../utils/prisma');
const { ok, notFound, forbidden } = require('../utils/respond');

async function getScoreHistory(req, res, next) {
  try {
    const take = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const skip = parseInt(req.query.offset, 10) || 0;

    // Build where clause based on query params
    const where: any = {};

    // Filter by internId if provided (query param or params)
    const internId = parseInt(req.params.internId, 10) || parseInt(req.query.internId, 10);
    if (!isNaN(internId)) {
      where.internId = internId;
    }

    // Filter by scoreType if provided
    if (req.query.scoreType) {
      where.scoreType = req.query.scoreType;
    }

    // If user is not admin, restrict to their own intern record
    if (req.user.role !== 'ADMIN' && req.user.role !== 'lead') {
      const intern = await prisma.intern.findUnique({ where: { userId: req.user.id } });
      if (!intern) {
        return notFound(res, 'Intern not found');
      }
      where.internId = intern.id;
    }

    const history = await prisma.scoreHistory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return ok(res, history);
  } catch (err) {
    next(err);
  }
}

module.exports = { getScoreHistory };
