var EventEmitter = require("events");

var chalk = require("chalk");
var kill = require("kill-with-style");

var debug = require("./debug");
var exec = require("./exec");
var AlivePassThrough = require("./alive-pass-through");

function RestartRunner(options) {
	this.options = Object.assign({}, this.defaults, options || {});

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			this.stdout = new AlivePassThrough();
		}
		if (this.options.stdio[2] == "pipe") {
			this.stderr = new AlivePassThrough();
		}
	}

	this.isStarted = false;

	this.ee = new EventEmitter();
}

RestartRunner.prototype.defaults = {
	restartOnError: true,
	restartOnSuccess: true,
	stdio: ["ignore", "pipe", "pipe"],
	shell: true,
	kill: {}
};

RestartRunner.prototype.on = function () {
	return this.ee.on.apply(this.ee, arguments);
};

RestartRunner.prototype.once = function () {
	return this.ee.once.apply(this.ee, arguments);
};

RestartRunner.prototype.off = function () {
	return this.ee.off.apply(this.ee, arguments);
};

RestartRunner.prototype.start = function (entry, callback) {
	var _callback = function () {
		if (callback) {
			callback.apply(null, arguments);
			callback = null;
		}
	}

	if (this.process) {
		return;
	}

	this.isStarted = true;

	var cmd;
	if (typeof(this.options.cmd) == "function") {
		cmd = this.options.cmd(entry);
	} else {
		cmd = this.options.cmd;
	}

	var child = exec(cmd, {
		shell: this.options.shell,
		stdio: this.options.stdio,
		debug: this.options.debug
	});

	this.process = child;

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			child.stdout.pipe(this.stdout);
		}

		if (this.options.stdio[2] == "pipe") {
			child.stderr.pipe(this.stderr);
		}
	}

	child.on("exit", function (code) {
		this.process = null;

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

		if (this._isRestating) {
			return
		}
		if (this.options.restartOnError && code != 0) {
			if (this.options.debug) {
				debug(chalk.green("Restart") + " on error "+  cmd);
			}
			this.start();
		} else if (this.options.restartOnSuccess && code == 0) {
			if (this.options.debug) {
				debug(chalk.green("Restart") + " on success " + cmd);
			}
			this.start();
		}
	}.bind(this));

	child.on("error", function (err) {
		this.process = null;
		this.ee.emit("error", err, cmd);
		_callback(err);
	}.bind(this));

	child.cmd = cmd;

	if (this.options.debug) {
		debug(chalk.green("Exec ") + "pid=" + child.pid + " " + cmd);
	}

	this.ee.emit("exec", cmd);

	if (child.pid) {
		setImmediate(_callback);
	}
};

RestartRunner.prototype.stop = function (callback) {
	this.isStarted = false;
	this.kill(callback);
};

RestartRunner.prototype.kill = function (callback) {
	callback = callback || function () {};
	if (this.isKilling) {
		return setImmediate(callback);
	}

	if (this.process && this.process.pid) {

		this.isKilling = true;
		this.ee.emit("kill", this.process.cmd);
		var pid = this.process.pid;
		var cmd = this.process.cmd;

		if (this.options.debug) {
			debug(chalk.red("Kill ") + this.process.cmd);
		}

		kill(pid, this.options.kill, function () {
			this.isKilling = false;
			this.ee.emit("kill", cmd);
			this.process = null;
			callback()
		}.bind(this));
	} else {
		setImmediate(callback);
	}
};

RestartRunner.prototype.restart = function (entry, callback) {
	callback = callback || function () {};
	this.ee.emit("restart");
	this._isRestating = true;
	this.kill(function () {
		this._isRestating = false;
		if (this.isStarted) {
			this.start(entry, callback);
		} else {
			setImmediate(callback);
		}
	}.bind(this));
};

module.exports = RestartRunner;
