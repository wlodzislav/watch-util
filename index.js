var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var EventEmitter = require("events");

var minimatch = require("minimatch");
var glob = require("glob");
var chalk = require("chalk");
var async = require("async");

var debug = require("./lib/debug");
var RestartRunner = require("./lib/restart-runner");
var QueueRunner = require("./lib/queue-runner");
var AlivePassThrough = require("./lib/alive-pass-through");
var Watcher = require("./lib/watcher");

function _interpolateCombinedCmd (cmd, options) {
	options = options || [];
	var filePaths = options.filePaths || [];
	if (cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFiles = filePaths.join(" ");
		var files = filePaths.map(function (f) { return path.resolve(f); }).join(" ");
		cmd = cmd
			.replace("%cwd", cwd)
			.replace("%relFiles", relFiles || "")
			.replace("%files", files || "");
	}

	return cmd;
}

var watcher = {};

/*
	watcher.exec(globs, callback)
	watcher.exec(globs, options, callback)
	watcher.exec(globs) - to use with .on(event, handler)
	watcher.exec(globs, options)
	watcher.exec(globs, cmd)
	watcher.exec(globs, options, cmd)
*/

var execDefaults = {
	debounce: 50,
	throttle: 0,
	reglob: 1000,
	restartOnError: false,
	events: ["create", "change", "delete"],
	checkMD5: false,
	checkMtime: true,
	deleteCheckInterval: 25,
	deleteCheckTimeout: 100,
	parallelLimit: 8,
	combineEvents: true,
	shell: true,
	stdio: [null, "ignore", "ignore"],
	kill: {
		signal: ["SIGTERM", "SIGTERM", "SIGKILL"]
	}
};

watcher.exec = function (globs) {
	var options, callback, cmd;
	if (arguments.length > 1) {
		if (typeof(arguments[1]) == "string") {
			cmd = arguments[1];
		} else if (typeof(arguments[1]) == "function") {
			callback = arguments[1];
		} else {
			options = arguments[1];
		}
	}
	if (arguments.length > 2) {
		if (typeof(arguments[1]) == "string") {
			cmd = arguments[2];
		} else {
			callback = arguments[2];
		}
	}

	options = options || {};
	if (options.kill) {
		options.kill = Object.assign({}, execDefaults.kill, options.kill || {});
	}
	options = Object.assign({}, execDefaults, options);

	var w;
	if (callback) {
		w = new Watcher(globs, options, callback);
	} else if (cmd) {
		w = new Watcher(globs, options, cmd);
	} else {
		w = new Watcher(globs, options);
	}

	w.start();

	return w;
}

var restartDefaults = {
	debounce: 50,
	throttle: 0,
	reglob: 1000,
	restartOnError: true,
	restartOnSuccess: true,
	events: ["create", "change", "delete"],
	checkMD5: false,
	checkMtime: true,
	deleteCheckInterval: 25,
	deleteCheckTimeout: 100,
	shell: true,
	stdio: [null, "ignore", "ignore"],
	kill: {
		signal: ["SIGTERM", "SIGTERM", "SIGKILL"]
	}
};

/*
	watcher.restart(globs, cmd)
	watcher.restart(globs, options, cmd)
*/
watcher.restart = function (globs) {
	var options, cmd;
	if (arguments.length == 2) {
		cmd = arguments[1];
	} else if (arguments.length == 3) {
		options = arguments[1];
		cmd = arguments[2];
	}

	options = options || {};
	if (options.kill) {
		options.kill = Object.assign({}, restartDefaults.kill, options.kill || {});
	}
	options = Object.assign({}, restartDefaults, options);

	options.callOnStart = true;
	options.combineEvents = true;

	var callback = function (filePaths) {
		w._restartRunner.restart(filePaths);
	};

	var w = new Watcher(globs, options, callback);

	options.cmd = function (options) {
		return _interpolateCombinedCmd(cmd, options);
	};
	w._restartRunner = new RestartRunner(options);

	// HACK: substitute ee to passthrough events
	w._restartRunner.ee = w.ee;

	if (options.stdio) {
		if (options.stdio[1] == "pipe") {
			w.stdout = new AlivePassThrough();
			w._restartRunner.stdout.pipe(w.stdout);
		}

		if (options.stdio[2] == "pipe") {
			w.stderr = new AlivePassThrough();
			w._restartRunner.stderr.pipe(w.stderr);
		}
	}

	w.on("start", function () {
		w._restartRunner.start();
	});

	var _stop = w.stop;
	w.stop = function (callback) {
		w._restartRunner.stop(function () {
			_stop.call(w, callback);
		});
	};

	w.start();

	return w;
}

watcher.Watcher = Watcher;

module.exports = watcher;
