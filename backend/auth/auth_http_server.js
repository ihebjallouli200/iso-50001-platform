const { startMainHttpServer } = require("../http_main_server");

function startAuthHttpServer(port = Number(process.env.PORT || 4001)) {
  return startMainHttpServer(port);
}

module.exports = {
  startAuthHttpServer,
};

if (require.main === module) {
  startAuthHttpServer();
}
