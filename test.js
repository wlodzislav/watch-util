var assert = require("assert");
var Watcher = require("./index").Watcher;
var shelljs = require("shelljs");
var fs = require("fs");

describe("", function () {
	this.timeout(5000);
	this.slow(500);

	before(function () {
		shelljs.rm("-rf", "temp");
		shelljs.mkdir("-p", "temp");
	});

	after(function() {
		shelljs.rm("-rf", "temp");
	});

	afterEach(function (done) {
		// wait for watcher to close
		setTimeout(done, 100);
	});

	it("on create", function (done) {
		var w = new Watcher(["temp/a"], { type: "exec", reglob: 10, debounce: 0, mtimeCheck: false }, function (fileName, action) {
			assert.equal(fileName, "temp/a");
			assert.equal(action, "create");
			w.stop();
			done();
		});
		w.start();

		setTimeout(function () {
			shelljs.touch("temp/a");
		}, 100);
	});

	it("on change", function (done) {
		shelljs.touch("temp/b");
		var w = Watcher(["temp/b"], { type: "exec", debounce: 0, mtimeCheck: false }, function (fileName, action) {
			assert.equal(fileName, "temp/b");
			assert.equal(action, "change");
			w.stop();
			done();
		});
		w.start();

		setTimeout(function () {
			shelljs.touch("temp/b");
		}, 100);
	});

	it("on change multiple", function (done) {
		shelljs.touch("temp/b2");
		var changes = 0;
		var w = Watcher(["temp/b2"], { type: "exec", debounce: 0, mtimeCheck: false }, function (fileName, action) {
			assert.equal(fileName, "temp/b2");
			assert.equal(action, "change");
			changes++;

			if (changes == 1) {
				setTimeout(function () {
					shelljs.touch("temp/b2");
				}, 0);
			}

			if (changes >= 2) {
				w.stop();
				done();
			}
		});
		w.start();

		setTimeout(function () {
			shelljs.touch("temp/b2");
		}, 100);
	});

	it("on remove", function (done) {
		shelljs.touch("temp/c");
		var w = Watcher(["temp/c"], { type: "exec", debounce: 0, mtimeCheck: false }, function (fileName, action) {
			assert.equal(fileName, "temp/c");
			assert.equal(action, "remove");
			w.stop();
			done();
		});
		w.start();

		setTimeout(function () {
			shelljs.rm("temp/c");
		}, 100);
	});

	it("cmd exec", function (done) {
		shelljs.touch("temp/d");
		var w1 = Watcher(["temp/e"], { type: "exec", reglob: 10, debounce: 0, mtimeCheck: false }, function (fileName, action) {
			w1.stop();
			w2.stop();
			done();
		});
		var w2 = Watcher(["temp/d"], { type: "exec", reglob: 10, debounce: 0, mtimeCheck: false }, "touch temp/e");

		w1.start();
		w2.start();
		setTimeout(function () {
			shelljs.touch("temp/d");
		}, 100);
	});

	it("cmd restart", function (done) {
		shelljs.touch("temp/f");
		var changes = 0;
		var w1 = Watcher(["temp/g"], { type: "exec", reglob: 10, debounce: 0, restartSignal: "SIGKILL", mtimeCheck: false }, function (fileName, action) {
			changes++;

			if (changes === 1) {
				setTimeout(function () {
					shelljs.touch("temp/f");
				}, 0);
			}
			if (changes >= 3) {
				var content = fs.readFileSync("temp/g", "utf8");
				assert.equal(content, "run\nrun\nrun\n");
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f"], { reglob: 10, debounce: 0, restartSignal: "SIGKILL", mtimeCheck: false }, "echo run >> temp/g; while true; do sleep 0.1; done;");

		w1.start();
		w2.start();
		setTimeout(function () {
			shelljs.touch("temp/f");
		}, 200);
	});

	it("cmd restart, exiting cmd", function (done) {
		shelljs.touch("temp/f");
		var changes = 0;
		var w1 = Watcher(["temp/g"], { type: "exec", reglob: 10, debounce: 0, restartSignal: "SIGKILL", mtimeCheck: false }, function (fileName, action) {
			changes++;

			if (changes === 1) {
				setTimeout(function () {
					shelljs.touch("temp/f");
				}, 0);
			}
			if (changes >= 3) {
				var content = fs.readFileSync("temp/g", "utf8");
				assert.equal(content, "run\nrun\nrun\nrun\nrun\nrun\n");
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f"], { reglob: 10, debounce: 0, restartSignal: "SIGKILL", mtimeCheck: false }, "echo run >> temp/g; sleep 0.1");

		w1.start();
		w2.start();
		setTimeout(function () {
			shelljs.touch("temp/f");
		}, 200);
	});

	it("cmd restart on error", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g2"], { type: "exec", reglob: 10, debounce: 0, stopSignal: "SIGKILL", mtimeCheck: false }, function (fileName, action) {
			changes++;

			if (changes >= 5) {
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f2"], { reglob: 10, debounce: 0, stopSignal: "SIGKILL", mtimeCheck: false, restartOnError: true }, "echo run >> temp/g2; exit 1;");

		w1.start();
		w2.start();
	});

	it("cmd don't restart on error", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g3"], { type: "exec", reglob: 10, debounce: 0, mtimeCheck: false }, function (fileName, action) {
			changes++;
		});
		var w2 = Watcher(["temp/f3"], { reglob: 10, debounce: 0, mtimeCheck: false, restartOnError: false }, "echo run >> temp/g3; exit 1;");
		setTimeout(function () {
			assert.equal(changes, 1);
			w1.stop();
			w2.stop();
			done();
		}, 300);
		w1.start();
		w2.start();
	});
	
	it("cmd restart on success", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g4"], { type: "exec", reglob: 10, debounce: 0, mtimeCheck: false }, function (fileName, action) {
			changes++;

			if (changes >= 5) {
				w1.stop();
				w2.stop();
				done();
			}
		});
		var w2 = Watcher(["temp/f4"], { reglob: 10, debounce: 0, mtimeCheck: false, restartOnSuccess: true }, "echo run >> temp/g4; exit 0;");
		w1.start();
		w2.start();
	});

	it("cmd don't restart on success", function (done) {
		var changes = 0;
		var w1 = Watcher(["temp/g5"], { type: "exec", reglob: 10, debounce: 0, mtimeCheck: false }, function (fileName, action) {
			changes++;
		});
		var w2 = Watcher(["temp/f5"], { reglob: 10, debounce: 0, mtimeCheck: false, restartOnSuccess: false }, "echo run >> temp/g5; exit 0;");
		setTimeout(function () {
			assert.equal(changes, 1);
			w1.stop();
			w2.stop();
			done();
		}, 300);
		w1.start();
		w2.start();
	});
});
