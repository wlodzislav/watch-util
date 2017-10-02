var http = require("http");

var program = require("commander");

var WSTransportServer = require("../ide/ws-transport-server");
var PM = require("./pm");

program
	.option("-p --port <port>", "Port to listen for WebSockets")
	.option("--debug", "Print debug info");

program.parse(process.argv);

var defaultPort = 9876;
program.port = program.port || defaultPort;

var pm = new PM();

var api = {
	createRule: pm.createRule.bind(pm),
	startById: pm.startById.bind(pm),
	stopById: pm.stopById.bind(pm),
	deleteById: pm.deleteById.bind(pm),
	startAll: pm.startAll.bind(pm),
	stopAll: pm.stopAll.bind(pm),
	restartAll: pm.restartAll.bind(pm),
	rules: pm.rules.bind(pm),
	getPid: function (callback) {
		callback(null, process.pid);
	}
};

var wsServer = http.createServer();
var wss = new WSTransportServer({ server: wsServer, api: api });

wsServer.listen(program.port);
