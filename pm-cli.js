var program = require("commander");
var child = require("child_process");
var WebSocketClient = require('ws');
var moment = require("moment");
var chalk = require("chalk");

debugLog = function () {
	console.log(moment().format("hh:mm:ss: ") + [].slice.call(arguments).join(" "));
}

var defaultPort = 9876;

var daemonSpawned = false;
var ws;
function spawnDaemon() {
	if (program.debug) {
		debugLog(chalk.green("Run"), "daemon on port", program.port);
	}
	var daemon = child.spawn("node daemon.js --port " + program.port, { shell: true, detached: true, stdio: "inherit" });
	daemonSpawned = true;
}

function connectToDaemon(onOpen) {
	program.port = program.port || defaultPort;
	if (program.debug) {
		debugLog(chalk.green("Connect"), "to daemon on port", program.port);
	}
	ws = new WebSocketClient('ws://localhost:'+program.port+'/ws');

	ws.on("open", function () {
		onOpen(createProxyWatcher());
	}).on("error", function() {
		if (daemonSpawned) {
			setTimeout(connectToDaemon.bind(null, onOpen), 100);
		} else {
			spawnDaemon();
			setTimeout(connectToDaemon.bind(null, onOpen), 100);
		}
	});
}

function send(obj) {
	// copy object to prevent changes between timeouts
	var jsonStr = typeof(obj) == "string" ? obj : JSON.stringify(obj);
	if (program.debug) {
		debugLog(chalk.green("Send"), jsonStr);
	}
	ws.send(jsonStr, function () {});
}

function sendResult(obj, callback) {
	// copy object to prevent changes between timeouts
	var jsonStr = typeof(obj) == "string" ? obj : JSON.stringify(obj);
	if (program.debug) {
		debugLog(chalk.green("Send"), jsonStr);
	}
	ws.on("message", function (rawMessage) {
		callback(JSON.parse(rawMessage).result);
	});
	ws.send(jsonStr, function () {});
}

function createProxyWatcher() {
	var target = {
		__calls: [],
		send: function () {
			send({ eval: "watcher." + this.__calls.map(function (c) { return c.name + "(" + c.args.map(JSON.stringify.bind(JSON)).join(", ") + ")"; }).join(".") });
			this.__calls = [];
			return proxy;
		},
		sendResult: function (callback) {
			sendResult({ evalResult: "watcher." + this.__calls.map(function (c) { return c.name + "(" + c.args.map(JSON.stringify.bind(JSON)).join(", ") + ")"; }).join(".") }, callback);
			this.__calls = [];
			return proxy;
		},
		close: function () {
			ws.close();
		}
	};
	var proxy = new Proxy(target, {
		get: function (target, name) {
			if (name in target || name === 'constructor') {
				return target[name];
			} else {
				return function() {
					target.__calls.push({ name: name, args: Array.prototype.slice.call(arguments) });
					return proxy;
				}
			}
		}
	});
	return proxy;
}

program
	.option("-p --port <port>", "")
	.option("--eval <code>", "")
	.option("--debug", "");

program
	.command("eval <code>")
	.action(function (code) {
		connectToDaemon(function () {
			console.log("wtf");
			if (!code.endsWith(".send()")) {
				code += ".send()";
			}
			eval(code);
			ws.close();
		});
	});

program
	.command("start <cmd>")
	.option("-e --exec", "Execute comand on changes, not reload")
	.option("-g --glob <patterns>", "Patterns to watch, separated by comma, ignore pattern starts with '!', for exact pattern syntax see: https://github.com/isaacs/node-glob")
	.option("-d --debounce <ms>", "Debounce exec/reload by ms, used for editors like vim that mv then rm files for crash safety")
	.option("-G --reglob <ms>", "Reglob interval to track new added files, on ms")
	.option("--no-restart-on-error", "Don't restart cmd if cmd crashes or exited with non 0 status")
	.option("--restart-on-success", "Restart cmd if cmd exited with 0 status")
	.action(function (cmd, options) {
		connectToDaemon(function (watcher) {
			watcher.addRule({
				type: options.exec ? "exec" : "restart",
				globPatterns: options.glob,
				cmdOrFun: cmd,
				debounce: options.debounce,
				reglob: options.reglob,
				restartOnError: options.restartOnError,
				restartOnSuccess: options.restartOnSuccess
			}).start().send().close();
		});
	});

program
	.command("list")
	.action(function () {
		connectToDaemon(function (watcher) {
			watcher.rules().toJSON().sendResult(function (result) {
				console.log(result);
			}).close();
		});
	});

program
	.command("stop <index>")
	.action(function (index) {
		connectToDaemon(function (watcher) {
			watcher.getRuleByIndex(index).stop().send().close();
		});
	});

program
	.command("restart <index>")
	.action(function (index) {
		connectToDaemon(function (watcher) {
			watcher.getRuleByIndex(index).restart().send().close();
		});
	});

program
	.command("delete <index>")
	.action(function (index) {
		connectToDaemon(function (watcher) {
			watcher.getRuleByIndex(index).delete().send().close();
		});
	});

program.parse(process.argv);

