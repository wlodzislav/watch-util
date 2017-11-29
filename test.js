var assert = require("assert");
var fs = require("fs");
var EventEmitter = require('events');
var express = require("express");
var bodyParser = require("body-parser");
var deepEqual = require('deep-equal');

var shelljs = require("shelljs");

var Watcher = require("./watcher");
var assign = require("./utils").assign;

var _port = 8555;
function Stub() {
	if (!(this instanceof Stub)) { return new Stub(); }

	this.ee = new EventEmitter();
	this.once = this.ee.once.bind(this.ee);

	this.port = _port++; // to make sure cmds for other watchers don't send /exec and /reload

	this.isCreated = false;
	this.createdFiles = [];
	this.isChanged = false;
	this.changedFiles = [];
	this.isDeleted = false;
	this.deletedFiles = [];

	this.isCmdExecuted = false
	this.execTimes = 0;
	this.isCmdReloaded = false;
	this.reloadTimes = 0;

	this.execCmd = "node test-helper.js --port " + this.port + " --type exec --file-name {relFile}";
	this.execCrashCmd = "node test-helper.js --port " + this.port + " --type exec --exit 1";
	this.reloadCmd = "node test-helper.js --port " + this.port + " --type reload";

	this.expectations = [];

	this._app = express();
	this._app.use(bodyParser.json());

	this._app.post("/exec", function (req, res) {
		var fileName = req.body.fileName;
		res.send({});

		this.isCmdExecuted = true;
		this.execTimes++;
		this.ee.emit("exec", fileName);
	}.bind(this));

	this._app.get("/reload", function (req, res) {
		res.send({});

		this.isCmdReloaded = true;
		this.reloadTimes++;
		this.ee.emit("reload");
	}.bind(this));

	this.callback = this.callback.bind(this);
}

Stub.prototype.callback = function () {
	if (arguments.length === 2) {
		var fileName = arguments[0];
		var action = arguments[1];

		if (action === "create") {
			this.isCreated = true;
			this.createdFiles.push(fileName);
		} else if (action === "change") {
			this.isChanged = true;
			this.changedFiles.push(fileName);
		} else if (action === "delete") {
			this.isDeleted = true;
			this.deletedFiles.push(fileName);
		}
	} else {
		var fileNames = arguments[0];
		this.isChanged = true;
		[].push.apply(this.changedFiles, fileNames);
	}

	if (this._callback) {
		this._callback.call(this, arguments);
	}
};

Stub.prototype._createCallback = function (exp) {
	return function () {
		if (arguments.length === 2) {
			var fileName = arguments[0];
			var action = arguments[1];

			if (exp.action !== action) {
				throw "Expected action \"" + exp.action + "\" but got \"" + action + "\"";
			}

			if (exp.fileName !== fileName) {
				throw "Expected file \"" + exp.fileName + "\" but got \"" + fileName + "\"";
			}

		} else {
			var fileNames = arguments[0];

			if (deepEqual(exp.fileNames, fileNames)) {
				throw "Expected files \"" + exp.fileNames.join(", ") + "\" but got \"" + fileNames.join(", ") + "\"";
			}
		}

		this._callback = null;
		this.next();
	}.bind(this);
};

Stub.prototype.start = function () {
	if (!this._started) {
		this._started = true;

		this._server = this._app.listen(this.port, function () {
			this.next();
		}.bind(this));
	}
};

Stub.prototype.next = function () {
	var exp = this.expectations[0];
	this.expectations = this.expectations.slice(1);

	if (!exp) {
		return;
	}

	if (["create", "change", "delete"].indexOf(exp.action) !== -1) {
		this._callback = this._createCallback(exp);
	} else if (exp.action === "tap") {
		exp.callback();
		this.next();
	} else if (exp.action === "wait") {
		setTimeout(this.next.bind(this), exp.timeout);
	} else if (exp.action === "exec" || exp.action === "reload") {
		this.once(exp.action, function (fileName) {
			if (exp.fileName && exp.fileName !== fileName) {
				throw "Expected cmd for file \"" + exp.fileName + "\" but got \"" + fileName + "\"";
			}
			this.next();
		}.bind(this));
	}
};

Stub.prototype.close = function () {
	this._server.close();
};

Stub.prototype.wait = function (timeout) {
	this.expectations.push({ action: "wait", timeout: timeout || 100 });
	this.start();
	return this;
};

Stub.prototype.tap = function (callback) {
	this.expectations.push({ action: "tap", callback: callback });
	this.start();
	return this;
};

Stub.prototype.expectCreate = function (fileName) {
	this.expectations.push({ action: "create", fileName: fileName });
	this.start();
	return this;
};

Stub.prototype.expectChange = function (fileName) {
	this.expectations.push({ action: "change", fileName: fileName });
	this.start();
	return this;
};

Stub.prototype.expectDelete = function (fileName) {
	this.expectations.push({ action: "delete", fileName: fileName });
	this.start();
	return this;
};

Stub.prototype.expectChanges = function (fileNames) {
	this.expectations.push({ action: "change", fileNames: fileNames });
	this.start();
	return this;
};

Stub.prototype.done = Stub.prototype.tap;

Stub.prototype.expectExec = function (fileName) {
	this.expectations.push({ action: "exec", fileName: fileName });
	return this;
};

Stub.prototype.waitExec = Stub.prototype.expectExec;

Stub.prototype.expectReload = function () {
	this.expectations.push({ action: "reload" });
	return this;
};

/*

stub.expectCreate("temp/a")
	.tap(change("temp/a"))
	.expectChange("temp/b")

.tap
.expectCreate
.expectChange
.expectDelete
.expectExec
.expectReload




*/

function create(f) {
	return function () {
		shelljs.touch(f);
	};
}

var change = create;

function rm(f) {
	return function () {
		shelljs.rm(f);
	};
}

var watcherInitTimeout = 100;

describe("", function () {
	this.timeout(5000);
	this.slow(500);

	var stub, w;
	beforeEach(function () {
		shelljs.mkdir("-p", "temp");
		stub = new Stub();
	});

	afterEach(function (done) {
		shelljs.rm("-rf", "temp");
		stub.close();

		w.stop(done);
	});

	var defaultOptions = { reglob: 50, debounce: 0, mtimeCheck: false, runSeparate: true, useShell: false };

	it("on create", function (done) {
		w = new Watcher(["temp/a"], assign({}, defaultOptions, { type: "exec" }), stub.callback);

		stub
			.tap(w.start.bind(w))
			.wait()
			.tap(create("temp/a"))
			.expectCreate("temp/a")
			.done(done);
	});

	it("on change", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "exec" }), stub.callback);

		stub
			.tap(create("temp/a"))
			.tap(w.start.bind(w))
			.wait()
			.tap(change("temp/a"))
			.expectChange("temp/a")
			.done(done);
	});

	it("on change multiple", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "exec" }), stub.callback);

		stub
			.tap(create("temp/a"))
			.tap(w.start.bind(w))
			.wait()
			.tap(change("temp/a"))
			.expectChange("temp/a")
			.tap(change("temp/a"))
			.expectChange("temp/a")
			.done(done);
	});

	it("on delete", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "exec" }), stub.callback);

		stub
			.tap(create("temp/a"))
			.tap(w.start.bind(w))
			.wait()
			.tap(rm("temp/a"))
			.expectDelete("temp/a")
			.done(done);
	});

	it("handle only some actions", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "exec", actions: ["delete"] }), stub.callback);

		stub
			.tap(w.start.bind(w))
			.wait()
			.tap(create("temp/a"))
			.wait()
			.tap(change("temp/a"))
			.wait()
			.tap(rm("temp/a"))
			.expectDelete("temp/a")
			.tap(function () {
				assert(!stub.isCreated);
				assert(!stub.isChanged);
			})
			.done(done);
	});

	it("cmd exec", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "exec", writeToConsole: true }), stub.execCmd);

		stub
			.tap(create("temp/a"))
			.tap(w.start.bind(w))
			.wait()
			.tap(change("temp/a"))
			.expectExec()
			.done(done);
	});

	it("cmd restart", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "reload", writeToConsole: true }), stub.reloadCmd);

		stub
			.tap(create("temp/a"))
			.tap(w.start.bind(w))
			.waitExec() // to make sure cmd is fully loaded
			.tap(change("temp/a"))
			.expectExec()
			.done(done);
	});

	it("cmd restart, exiting cmd", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "reload", restartOnSuccess: false }), stub.execCmd);

		stub
			.tap(create("temp/a"))
			.tap(w.start.bind(w))
			.waitExec().wait() // to make sure cmd is exited
			.tap(change("temp/a"))
			.expectExec()
			.done(done);
	});

	it("cmd restart on error", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "reload", restartOnSuccess: false, restartOnError: true }), stub.execCrashCmd);

		stub
			.tap(w.start.bind(w))
			.expectExec()
			.expectExec()
			.done(done);
	});

	it("cmd don't restart on error", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "reload", restartOnSuccess: false, restartOnError: false, writeToConsole: true }), stub.execCrashCmd);

		stub
			.tap(w.start.bind(w))
			.expectExec()
			.wait(3000)
			.tap(function () {
				assert.equal(stub.execTimes, 1);
				assert(!stub.isCmdReloaded);
			})
			.done(done);
	});
	
	it("cmd restart on success", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "reload", restartOnSuccess: true, restartOnError: false }), stub.execCmd);

		stub
			.tap(w.start.bind(w))
			.expectExec()
			.expectExec()
			.done(done);
	});

	it("cmd don't restart on success", function (done) {
		w = Watcher(["temp/a"], assign({}, defaultOptions, { type: "reload", restartOnSuccess: false, restartOnError: false }), stub.execCmd);

		stub
			.tap(w.start.bind(w))
			.expectExec()
			.wait(500)
			.tap(function () {
				assert.equal(stub.execTimes, 1);
				assert(!stub.isCmdReloaded);
			})
			.done(done);
	});
	
	it("runSeparate == true", function (done) {
		w = Watcher(["temp/a", "temp/b"], assign({}, defaultOptions, { type: "exec", runSeparate: true, debounce: 100 }), stub.execCmd);

		stub
			.tap(create("temp/a"))
			.tap(create("temp/b"))
			.tap(w.start.bind(w))
			.wait()
			.tap(change("temp/a"))
			.tap(change("temp/b"))
			.wait(2000)
			.tap(function () {
				assert.equal(stub.execTimes, 2);
			})
			.done(done);
	});

	it("runSeparate == false", function (done) {
		w = Watcher(["temp/a", "temp/b"], assign({}, defaultOptions, { type: "exec", runSeparate: false, debounce: 100 }), stub.execCmd);

		stub
			.tap(create("temp/a"))
			.tap(create("temp/b"))
			.tap(w.start.bind(w))
			.wait()
			.tap(change("temp/a"))
			.tap(change("temp/b"))
			.wait(2000)
			.tap(function () {
				assert.equal(stub.execTimes, 1);
			})
			.done(done);
	});

	it(".stop() terminates reloading cmd during reload");
	it(".stop() terminates runSeparate=true cmds runnning during reload");
	it(".stop() terminates restartingOnSuccess=true cmd during reload");
	it(".stop() terminates restartingOnError=true cmd during reload");
});
