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

	this.execCmd = "node test-helper.js --port " + this.port + " --type exec -- ${relFile}";
	this.execCmdBatch = "node test-helper.js --port " + this.port + " --type exec -- ${relFiles}";
	this.execCrashCmd = "node test-helper.js --port " + this.port + " --type exec --exit 1";
	this.reloadCmd = "node test-helper.js --port " + this.port + " --type reload";

	this.actions = [];

	this._app = express();
	this._app.use(bodyParser.json());

	this._app.post("/exec", function (req, res) {
		var fileNames = req.body.fileNames;
		res.send({});

		this.isCmdExecuted = true;
		this.execTimes++;

		if (this._waitEvent) {
			this._waitEvent({ action: "exec", fileNames });
		}
	}.bind(this));

	this._app.get("/reload", function (req, res) {
		res.send({});

		this.isCmdReloaded = true;
		this.reloadTimes++;

		if (this._waitEvent) {
			this._waitEvent({ action: "reload" });
		}
	}.bind(this));

	this.events = [];
	this.callback = this.callback.bind(this);

	this._started = false;
}

Stub.prototype.start = function (callback) {
	this._server = this._app.listen(this.port, callback);
};

Stub.prototype.stop = function () {
	this._server.close();
};

Stub.prototype._runActions = function (callback) {
	if (!this._started) {
		setTimeout(this.next.bind(this), 0);
		this._started = true;
	}
};

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

		this.events.push({ action, fileName });
	} else {
		var fileNames = arguments[0];

		this.isChanged = true;
		[].push.apply(this.changedFiles, fileNames);

		this.events.push({ action: "change", fileNames });
	}

	if (this._waitEvent) {
		this._waitEvent(this.events[this.events.length - 1]);
	}
};

Stub.prototype.next = function () {
	var a = this.actions.shift();
	if (!a) {
		return this.done();
	}
	if (a.action == "wait") {
		setTimeout(this.next.bind(this), a.timeout);
	} else if (a.action == "tap") {
		try {
			a.fn();
		} catch (err) {
			return this.done(err);
		}
		this.next();

	} else if (a.action == "waitEvent") {
		if (this._expectedEvent) {
			return this.done(new Error("Previous event didn't fired: " + JSON.stringify(this._expectedEvent)));
		}
		this._expectedEvent = a.event;
		this._waitEvent = function (event) {
			if (this._expectedEvent.action == "exec" && event.action == "exec" && !this._expectedEvent.fileNames) {
				// ok
			} else {
				try {
					assert.deepEqual(this._expectedEvent, event);
				} catch (err) {
					return this.done(err);
				}
			}
			this._waitEvent = null;
			this._expectedEvent = null;
			this.next();
		}.bind(this);
	}
};

Stub.prototype.wait = function (timeout) {
	this.actions.push({ action: "wait", timeout: timeout || 100 });
	this._runActions();
	return this;
};

Stub.prototype.tap = function (fn) {
	this.actions.push({ action: "tap", fn: fn });
	this._runActions();
	return this;
};

Stub.prototype.expectCreate = function (fileName) {
	this.actions.push({ action: "waitEvent", event: { action: "create", fileName }});
	this._runActions();
	return this;
};

Stub.prototype.expectChange = function (fileName) {
	this.actions.push({ action: "waitEvent", event: { action: "change", fileName }});
	this._runActions();
	return this;
};

Stub.prototype.expectDelete = function (fileName) {
	this.actions.push({ action: "waitEvent", event: { action: "delete", fileName }});
	this._runActions();
	return this;
};

Stub.prototype.expectChanges = function (fileNames) {
	this.actions.push({ action: "waitEvent", event: { action: "change", fileNames }});
	this._runActions();
	return this;
};

Stub.prototype.expectExec = function (fileNames) {
	if (fileNames && !Array.isArray(fileNames)) {
		fileNames = [fileNames];
	}
	this.actions.push({ action: "waitEvent", event: { action: "exec", fileNames: fileNames }});
	this._runActions();
	return this;
};

Stub.prototype.waitExec = Stub.prototype.expectExec;

Stub.prototype.expectReload = function () {
	this.actions.push({ action: "waitEvent", event: { action: "reload" }});
	this._runActions();
	return this;
};

Stub.prototype.done = function (done) {
	this.done = done;
};

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
	beforeEach(function (done) {
		shelljs.mkdir("-p", "temp");
		stub = new Stub();
		stub.start(done);
	});

	afterEach(function (done) {
		shelljs.rm("-rf", "temp");
		stub.stop();

		w.stop(done);
	});

	var defaultOptions = { reglob: 50, debounce: 0, mtimeCheck: false, runSeparate: true, useShell: false };

	function opts(options) {
		return Object.assign({}, defaultOptions, options || {});
	}

	describe("handle events", function () {
		it("create", function (done) {
			w = new Watcher(["temp/a"], opts(), stub.callback);

			stub
				.tap(w.start.bind(w))
				.wait()
				.tap(create("temp/a"))
				.expectCreate("temp/a")
				.tap(function () {
					assert(stub.isCreated);
					assert(!stub.isChanged);
					assert(!stub.isDeleted);
					assert.deepEqual(stub.createdFiles, ["temp/a"]);
				})
				.done(done);
		});

		it("change", function (done) {
			w = Watcher(["temp/a"], opts(), stub.callback);

			stub
				.tap(create("temp/a"))
				.tap(w.start.bind(w))
				.wait()
				.tap(change("temp/a"))
				.expectChange("temp/a")
				.tap(function () {
					assert(!stub.isCreated);
					assert(stub.isChanged);
					assert(!stub.isDeleted);
					assert.deepEqual(stub.changedFiles, ["temp/a"]);
				})
				.done(done);
		});

		it("delete", function (done) {
			w = Watcher(["temp/a"], opts(), stub.callback);

			stub
				.tap(create("temp/a"))
				.tap(w.start.bind(w))
				.wait()
				.tap(rm("temp/a"))
				.expectDelete("temp/a")
				.tap(function () {
					assert(!stub.isCreated);
					assert(!stub.isChanged);
					assert(stub.isDeleted);
					assert.deepEqual(stub.deletedFiles, ["temp/a"]);
				})
				.done(done);
		});
		it("multiple events", function (done) {
			w = Watcher(["temp/a"], opts(), stub.callback);

			stub
				.tap(create("temp/a"))
				.tap(w.start.bind(w))
				.wait()
				.tap(change("temp/a"))
				.expectChange("temp/a")
				.tap(change("temp/a"))
				.expectChange("temp/a")
				.tap(function () {
					assert(!stub.isCreated);
					assert(stub.isChanged);
					assert(!stub.isDeleted);
					assert.deepEqual(stub.changedFiles, ["temp/a", "temp/a"]);
				})
				.done(done);
		});


		it("handle only some actions", function (done) {
			w = Watcher(["temp/a"], opts({ actions: ["delete"] }), stub.callback);

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
					assert(stub.isDeleted);
					assert.deepEqual(stub.deletedFiles, ["temp/a"]);
				})
				.done(done);
		});
	});

	describe("cmd", function () {
		it("cmd exec", function (done) {
			w = Watcher(["temp/a"], opts({ type: "exec", writeToConsole: true }), stub.execCmd);

			stub
				.tap(create("temp/a"))
				.tap(w.start.bind(w))
				.wait()
				.tap(change("temp/a"))
				.expectExec()
				.tap(function () {
					//assert.deepEqual(stub.changedFiles, ["temp/a"]);
				})
				.done(done);
		});

		it("cmd restart", function (done) {
			w = Watcher(["temp/a"], opts({ type: "reload", writeToConsole: true }), stub.reloadCmd);

			stub
				.tap(create("temp/a"))
				.tap(w.start.bind(w))
				.waitExec() // to make sure cmd is fully loaded
				.tap(change("temp/a"))
				.expectExec()
				.done(done);
		});

		it("cmd restart, exiting cmd", function (done) {
			w = Watcher(["temp/a"], opts({ type: "reload", restartOnSuccess: false }), stub.execCmd);

			stub
				.tap(create("temp/a"))
				.tap(w.start.bind(w))
				.waitExec().wait() // to make sure cmd is exited
				.tap(change("temp/a"))
				.expectExec()
				.done(done);
		});

		it("cmd restart on error", function (done) {
			w = Watcher(["temp/a"], opts({ type: "reload", restartOnSuccess: false, restartOnError: true }), stub.execCrashCmd);

			stub
				.tap(w.start.bind(w))
				.expectExec()
				.expectExec()
				.done(done);
		});

		it("cmd don't restart on error", function (done) {
			w = Watcher(["temp/a"], opts({ type: "reload", restartOnSuccess: false, restartOnError: false, writeToConsole: true }), stub.execCrashCmd);

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
			w = Watcher(["temp/a"], opts({ type: "reload", restartOnSuccess: true, restartOnError: false }), stub.execCmd);

			stub
				.tap(w.start.bind(w))
				.expectExec()
				.expectExec()
				.done(done);
		});

		it("cmd don't restart on success", function (done) {
			w = Watcher(["temp/a"], opts({ type: "reload", restartOnSuccess: false, restartOnError: false }), stub.execCmd);

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
			w = Watcher(["temp/a", "temp/b"], opts({ type: "exec", runSeparate: true, debounce: 100 }), stub.execCmd);

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
			w = Watcher(["temp/a", "temp/b"], opts({ type: "exec", runSeparate: false, debounce: 100 }), stub.execCmdBatch);

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
	});

	it(".stop() terminates reloading cmd during reload");
	it(".stop() terminates runSeparate=true cmds runnning during reload");
	it(".stop() terminates restartingOnSuccess=true cmd during reload");
	it(".stop() terminates restartingOnError=true cmd during reload");
});
