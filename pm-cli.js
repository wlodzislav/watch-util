var child = require("child_process");

var program = require("commander");
var chalk = require("chalk");
var TerminalTable = require('cli-table');
var moment = require("moment");

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
	.command("create <cmd...>")
	.description("Create and start process or start existing one by id")
	.option("--id <id>", "Set rule id")
	.option("-e --exec", "Execute comand on changes, not reload")
	.option("-g --glob <patterns>", "Patterns to watch, separated by comma, ignore pattern starts with '!', for exact pattern syntax see: https://github.com/isaacs/node-glob")
	.option("-d --debounce <ms>", "Debounce exec/reload by ms, used for editors like vim that mv then rm files for crash safety")
	.option("-G --reglob <ms>", "Reglob interval to track new added files, on ms")
	.option("--no-restart-on-error", "Don't restart cmd if cmd crashes or exited with non 0 status")
	.option("--restart-on-success", "Restart cmd if cmd exited with 0 status")
	.action(function (cmd, options) {
		if (Array.isArray(cmd)) {
			cmd = cmd.join(" ");
		}
		connectToDaemon(function (pm) {
			var id = options.id || genUID();
			pm.createRule({
				id: id,
				type: options.exec ? "exec" : "restart",
				globs: options.glob,
				cmdOrFun: cmd,
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
					pm.disconnect();

					if (err) {
						logError(err);
						process.exit(errorCodeToExitCode[err.code]);
					}
				});
			});
		});
	});

program
	.command("start <id...>")
	.description("Start existing process by id")
	.action(function (id, options) {
		connectToDaemon(function (pm) {
			pm.startById(id, function (err) {
				pm.disconnect();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
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
							options.plain ? row.runState : (row.runState === "running" ? chalk.green("running") : chalk.red(row.runState)),
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
			pm.stopById(id, function (err) {
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
			pm.restartById(id, function (err) {
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
			pm.deleteById(id, function (err) {
				pm.disconnect();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
	});

program
	.command("pause <id>")
	.description("Pause process by id")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.pauseById(id, function (err) {
				pm.disconnect();
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}
			});
		});
	});

program
	.command("logs")
	.description("Show logs for all processes")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.logs(function (err, logs) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();

				var flatLog = [];
				Object.keys(logs).forEach(function (id) {
					logs[id].forEach(function (entry) {
						entry._id = id;
						flatLog.push(entry);
					});
				});

				flatLog.sort(function (a, b) {
					return a.date - b.date;
				});

				flatLog.forEach(function (entry) {
					var formattedDate = moment(entry.date).format("HH:mm:ss");
					var text = entry.text.replace(/\n$/, "");
					if (entry.stream === "stderr") {
						text = chalk.red(text);
					}

					console.log(formattedDate + " " + chalk.green(entry._id) + ": " + text);
				});
			});
		});
	});
program
	.command("log <id>")
	.description("Show log for process with id")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.getLogById(id, function (err, log) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();

				log.forEach(function (entry) {
					var text = entry.text.replace(/\n$/, "");
					if (entry.stream === "stderr") {
						text = chalk.red(text);
					}

					console.log(formattedDate + ": " + text);
				});
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

program
	.command("pause-all-running")
	.description("Pause all running")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.pauseAllRunning(function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program
	.command("start-all-paused")
	.description("Start all paused")
	.action(function (id) {
		connectToDaemon(function (pm) {
			pm.startAllPaused(function (err) {
				if (err) {
					logError(err);
					process.exit(errorCodeToExitCode[err.code]);
				}

				pm.disconnect();
			});
		});
	});

program.parse(process.argv);

