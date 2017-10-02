var child = require("child_process");

var program = require("commander");
var chalk = require("chalk");
var TerminalTable = require('cli-table');

var utils = require("./utils");
var debugLog = utils.debugLog;
var genUID = utils.genUID;
var assign = utils.assign;
var terminate = require("./terminate");

var WSTransport = require("../ide/client/ws-transport");

var defaultPort = 9876;

var daemonSpawned = false;
function spawnDaemon() {
	console.log("Spawning daemon...");
	if (program.debug) {
		debugLog(chalk.green("Run"), "daemon on port", program.port);
	}
	var daemon = child.spawn("node pm-daemon.js --port " + program.port, { shell: true, detached: true, stdio: "inherit" });
	daemon.unref();
	daemonSpawned = true;
}

function connectToDaemon(onOpen) {
	program.port = program.port || defaultPort;
	if (program.debug) {
		debugLog(chalk.green("Connect"), "to daemon on port", program.port);
	}
	var pm = WSTransport.create({
		port: program.port
	});
	pm.once("apiInitialized", function () {
		onOpen(pm);
	});
	pm.once("error", function () {
		if (!daemonSpawned) {
			spawnDaemon();
		}
	});
	pm.connect();
}

function connectOrKill() {
	program.port = program.port || defaultPort;

	var pm = WSTransport.create({ port: program.port});
	pm.once("apiInitialized", function () {
		pm.getPid(function (err, pid) {
			pm.disconnect();
			terminate(pid, {}, function (err) {
				process.exit(0);
			});
		});
	});
	pm.once("error", function () {
		process.exit(0);
	});
	pm.connect();
}

function logError(err) {
	console.log(chalk.red("Error:"), chalk.red.bold(err.code), "-", err.message);
}

program
	.option("-p --port <port>", "Port to listen/connect to WebSockets")
	.option("--debug", "Print debug info");

program
	.command("kill-daemon")
	.description("Kill PM daemon")
	.action(function () {
		connectOrKill();
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
			connectToDaemon(function (pm) {
				pm.startById(+cmdOrId, function (err) {
					if (err) {
						logError(err);
						process.exit(errorCodeToExitCode[err.code]);
					}

					pm.disconnect();
				});
			});
		} else {
			// start new process
			connectToDaemon(function (pm) {
				var id = genUID();
				pm.createRule({
					id: id,
					type: options.exec ? "exec" : "restart",
					globs: options.glob,
					cmdOrFun: cmdOrId,
					debounce: options.debounce,
					reglob: options.reglob,
					restartOnError: options.restartOnError,
					restartOnSuccess: options.restartOnSuccess
				}, function (err) {
					if (err) {
						logError(err);
						process.exit(errorCodeToExitCode[err.code]);
					}

					pm.startById(id, function (err) {
						if (err) {
							logError(err);
							process.exit(errorCodeToExitCode[err.code]);
						}

						pm.disconnect();
					});
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
		connectToDaemon(function (pm) {
			pm.rules(function (err, result) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();

				if (options.json) {
					console.log(result);
				} else {
					if (result.length === 0 & !options.plain) {
						console.log(chalk.red("No processes started"));
						return;
					}
					var table = new TerminalTable(assign({
						head: ["ID", "TYPE", "STARTED", "GLOB", "CMD"],
					}, options.plain ? plainTableOptions : tableOptions));
					result.forEach(function (row) {
						table.push([
							row.id,
							row.type,
							options.plain ? (row.started ? "started" : "stopped") : (row.started ? chalk.green("started") : chalk.red("stopped")),
							options.plain ? row.globs : chalk.grey(row.globs),
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
		connectToDaemon(function (pm) {
			pm.stopById(+id, function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program
	.command("restart <id>")
	.description("Restart process by id")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.restartById(+id, function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program
	.command("delete <id>")
	.description("Delete process by id")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.deleteById(+id, function (err) {
				pm.disconnect();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
	});

program
	.command("start-all")
	.description("Start all processes")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.startAll(function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program
	.command("stop-all")
	.description("Stop all processes")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.stopAll(function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program
	.command("restart-all")
	.description("Restart all processes")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.restartAll(function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program.parse(process.argv);

