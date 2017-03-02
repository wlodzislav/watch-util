var program = require("commander");
var child = require("child_process");
var WebSocketClient = require('ws');
var moment = require("moment");
var chalk = require("chalk");
var TerminalTable = require('cli-table');
var _ = require("lodash");

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
	daemon.unref();
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
		var message = JSON.parse(rawMessage);
		callback(message.err, message.result);
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

function logError(err) {
	console.log(chalk.red("Error:"), chalk.red.bold(err.code), "-", err.message);
}

var errorCodeToExitCode = {
	"RULE_NOT_FOUND": 1
};

program
	.option("-p --port <port>", "Port to listen/connect to WebSockets")
	.option("--debug", "Print debug info");

program
	.command("eval <code>")
	.description("Eval line of code directly in daemon")
	.action(function (code) {
		connectToDaemon(function (watcher) {
			sendResult({ evalResult: code }, function (err, result) {
				watcher.close();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				} else {
					console.log(result);
				}
			});
		});
	});

program
	.command("start <cmdOrId...>")
	.description("Create and start process or start existing one by id")
	.option("-e --exec", "Execute comand on changes, not reload")
	.option("-g --glob <patterns>", "Patterns to watch, separated by comma, ignore pattern starts with '!', for exact pattern syntax see: https://github.com/isaacs/node-glob")
	.option("-d --debounce <ms>", "Debounce exec/reload by ms, used for editors like vim that mv then rm files for crash safety")
	.option("-G --reglob <ms>", "Reglob interval to track new added files, on ms")
	.option("--no-restart-on-error", "Don't restart cmd if cmd crashes or exited with non 0 status")
	.option("--restart-on-success", "Restart cmd if cmd exited with 0 status")
	.action(function (cmdOrId, options) {
		if (Array.isArray(cmdOrId)) {
			cmdOrId = cmdOrId.join(" ");
		}
		if (+cmdOrId == ""+cmdOrId && !options.glob) {
			// start existing process
			connectToDaemon(function (watcher) {
				watcher.startById(+cmdOrId).sendResult(function (err) {
					watcher.close()
					if (err) {
						logError(err);
						process.exit(errorCodeToExitCode[err.code]);
					}
				});
			});
		} else {
			// start new process
			connectToDaemon(function (watcher) {
				watcher.addRule({
					type: options.exec ? "exec" : "restart",
					globPatterns: options.glob,
					cmdOrFun: cmdOrId,
					debounce: options.debounce,
					reglob: options.reglob,
					restartOnError: options.restartOnError,
					restartOnSuccess: options.restartOnSuccess
				}).start().sendResult(function (err) {
					watcher.close()
					if (err) {
						logError(err);
						process.exit(errorCodeToExitCode[err.code]);
					}
				});
			});
		}
	});

var plainTableOptions = {
	chars: { "top": "", "top-mid": "", "top-left": "", "top-right": "",
		"bottom": "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
		"left": "", "left-mid": "", "mid": "", "mid-mid": "", "right": "",
		"right-mid": "", "middle": " "
	},
	style: { "padding-left": 0, "padding-right": 0, head : [] }
};

var tableOptions = {
	style : { head : ["cyan"] }
};

program
	.command("list")
	.description("List all processes")
	.option("--json", "Print in json format")
	.option("--plain", "Print in plain text format")
	.action(function (options) {
		connectToDaemon(function (watcher) {
			watcher.rules().toJSON().sendResult(function (err, result) {
				watcher.close();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				if (options.json) {
					console.log(result);
				} else {
					if (result.length === 0 & !options.plain) {
						console.log(chalk.red("No processes started"));
						return;
					}
					var table = new TerminalTable(_.assign({
						head: ["ID", "TYPE", "STARTED", "GLOB", "CMD"],
					}, options.plain ? plainTableOptions : tableOptions));
					result.forEach(function (row) {
						table.push([
							row.id,
							row.type,
							options.plain ? (row.started ? "started" : "stopped") : (row.started ? chalk.green("started") : chalk.red("stopped")),
							options.plain ? row.globPatterns : chalk.grey(row.globPatterns),
							row.cmdOrFun
						]);
					});
					console.log(table.toString());
				}
			});
		});
	});

program
	.command("stop <id>")
	.description("Stop process by id")
	.action(function (id) {
		connectToDaemon(function (watcher) {
			watcher.stopById(+id).sendResult(function (err, result) {
				watcher.close();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
	});

program
	.command("restart <id>")
	.description("Restart process by id")
	.action(function (id) {
		connectToDaemon(function (watcher) {
			watcher.restartById(+id).sendResult(function (err, result) {
				watcher.close();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
	});

program
	.command("delete <id>")
	.description("Delete process by id")
	.action(function (id) {
		connectToDaemon(function (watcher) {
			watcher.deleteById(+id).sendResult(function (err, result) {
				watcher.close();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
	});

program.parse(process.argv);

