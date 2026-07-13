const chatService = require('../services/chat-service');

async function createSession(req, res, next) {
  try {
    return res.ok('Tạo chat session thành công.', await chatService.createSession(req.user, req.body), 201);
  } catch (error) { return next(error); }
}

async function listSessions(req, res, next) {
  try {
    return res.ok('OK', await chatService.listSessions(req.user, req.query));
  } catch (error) { return next(error); }
}

async function getHistory(req, res, next) {
  try {
    return res.ok('OK', await chatService.getHistory(req.user, req.params.id, req.query));
  } catch (error) { return next(error); }
}

async function deleteSession(req, res, next) {
  try {
    await chatService.deleteSession(req.user, req.params.id);
    return res.status(204).end();
  } catch (error) { return next(error); }
}

async function sendMessage(req, res, next) {
  try {
    return res.ok('Chat response completed.', await chatService.sendMessage(req.user, req.params.id, req.body));
  } catch (error) { return next(error); }
}

module.exports = { createSession, listSessions, getHistory, deleteSession, sendMessage };
