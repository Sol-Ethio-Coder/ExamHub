// Netlify Functions entry point: /api/* is rewritten here (see netlify.toml).
const serverless = require('serverless-http');
const app = require('../../server');
module.exports.handler = serverless(app, {
  binary: ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
});
