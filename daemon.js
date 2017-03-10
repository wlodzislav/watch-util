var program = require("commander");
var WebSocketServer = require("ws").Server;
var http = require("http");
var PM = require("./index").PM;

program
	.option("-p --port <port>", "Port to listen for WebSockets")
	.option("--debug", "Print debug info");

program.parse(process.argv);

var defaultPort = 9876;
program.port = program.port || defaultPort;

var pm = PM({ debug: program.debug });

var server = http.createServer();
server.listen(program.port);
var wss = new WebSocketServer({ server: server });
wss.on("connection", function(ws) {
	ws.on("message", function(messageRaw) {
		var message = JSON.parse(messageRaw);
		if(message.who) {
			ws.send(JSON.stringify({ me: "PM_DAEMON" }));
		} else if (message.eval) {
			console.log("Eval", message.eval);
			try {
				eval(message.eval);
			} catch (err) {
				console.log("Crash on eval", message.eval);
				console.log(err);
				ws.send(JSON.stringify({ err: err }));
			}
		} else if (message.evalResult) {
			console.log("Eval", message.evalResult);
			try {
				var result;
				eval("result = " + message.evalResult);
				console.log(result);
				ws.send(JSON.stringify({ result: result }));
			} catch (err) {
				console.log("Crash on eval", message.evalResult);
				console.log(err);
				ws.send(JSON.stringify({ err: err }));
			}
		}
	});
});
