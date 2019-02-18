var EventEmitter = require("events");

var chalk = require("chalk");
var async = require("async");
var kill = require("kill-with-style");

var debug = require("./debug");
var exec = require("./exec");
var AlivePassThrough = require("./alive-pass-through");

var queueRunnerDefaults = {
	parallelLimit: 8,
	restartOnError: false,
	stdio: ["ignore", "pipe", "pipe"],
	shell: true,
	kill: {}
};

function QueueRunner(options) {
	this.options = Object.assign({}, queueRunnerDefaults, options || {});

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			this.stdout = new AlivePassThrough();
		}
		if (this.options.stdio[2] == "pipe") {
			this.stderr = new AlivePassThrough();
		}
	}

	this.isStarted = false;
	this.processes = [];

	this.ee = new EventEmitter();
}


QueueRunner.prototype.on = function () {
	return this.ee.on.apply(this.ee, arguments);
};

QueueRunner.prototype.once = function () {
	return this.ee.once.apply(this.ee, arguments);
};

QueueRunner.prototype.off = function () {
	return this.ee.off.apply(this.ee, arguments);
};

QueueRunner.prototype.start = function (callback) {
	var _callback = function () {
		if (callback) {
			callback.apply(null, arguments);
			callback = null;
		}
	}

	this.queue = [];
	this.isStarted = true;
	this.exec();
}

QueueRunner.prototype.push = function (entry) {
	this.queue.push(entry);
	if (this.options.debug) {
		debug(chalk.green("Pushed") + " to queue " + JSON.stringify(entry));
	}
	if (this.options.reducer) {
		this.queue = this.options.reducer(this.queue);
	}

	this.exec();
};

QueueRunner.prototype.exec = function () {
	if (!this.isStarted) {
		return;
	}

	if (this.processes.length >= this.options.parallelLimit) {
		return;
	}

	if (!this.queue.length) {
		return;
	}

	var entry;
	if (this.options.skip) {
		var runningEntries = this.processes.map(function (p) { return p.entry; });
		var index = this.queue.findIndex(function (e) { return !this.options.skip(e, runningEntries); }.bind(this));
		if (index != -1) {
			entry = this.queue[index];
			this.queue.splice(index, 1);
		}
	} else {
		var entry = this.queue.shift();
	}

	if (!entry) {
		return;
	}

	var cmd = entry.cmd || this.options.cmd(entry);

	var child = exec(cmd, {
		shell: this.options.shell,
		stdio: this.options.stdio,
		debug: this.options.debug
	});

	this.processes.push(child);

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			child.stdout.pipe(this.stdout);
		}

		if (this.options.stdio[2] == "pipe") {
			child.stderr.pipe(this.stderr);
		}
	}

	child.on("exit", function (code) {
		if (this.options.debug) {
			debug(chalk.red("Exited ") + cmd);
		}

		this.ee.emit("exit", code, cmd);

		if (code != 0) {
			this.ee.emit("crash", code, cmd);
		}

		if (!this.isStarted) {
			return;
		}
		this.processes.splice(this.processes.indexOf(child), 1);
		if (this.options.restartOnError && code != 0) {
			if (this.options.debug) {
				debug(chalk.green("Restart") + " on error "+ cmd);
			}
			this.push(entry);
		}
		this.exec();
	}.bind(this));

	child.on("error", function (err) {
		this.processes.splice(this.processes.indexOf(child), 1);
		this.ee.emit("error", err);
	}.bind(this));

	child.entry = entry;
	child.cmd = cmd;

	if (this.options.debug) {
		debug(chalk.green("Exec ") + "pid=" + child.pid + " " + cmd);
	}

	this.ee.emit("exec", cmd);

	this.exec();
};

QueueRunner.prototype.stop = function (callback) {
	callback = callback || function () {};
	this.isStarted = false;
	async.each(this.processes, function (c, callback) {
		var cmd = c.cmd;
		if (this.options.debug) {
			debug(chalk.red("Kill ") + c.cmd);
		}

		if (!c.pid) {
			return setInterval(callback);
		}

		kill(c.pid, this.options.kill, function () {
			this.ee.emit("kill", cmd);
			callback();
		}.bind(this));
	}.bind(this), function () {
		callback();
	}.bind(this));
	this.processes = null;
};

module.exports = QueueRunner;
