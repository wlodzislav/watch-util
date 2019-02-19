# Versatile watcher lib and shell commands for watching files, running and restarting shell commands

Watch files, run and restart shell commands on changes.

Provides both API and shell commands with consistent options naming.

```javascript
var watch = require("watch-util");

// with callback

var globs = ["**/*", "!node_modules/", "!test/", "test/test.js"];
var options = { events: ["create", "change"], combineEvents: false };
var w = new watch.Watcher(globs, options, function (filePath, event) {
	/* ... */
});
w.start();

// or listen to events

var w = new watch.Watcher(["**/*"]);
w.start();
w.on("create", function (filePath) { /* ... */ });
w.on("change", function (filePath) { /* ... */ });
w.on("delete", function (filePath) { /* ... */ });
w.on("all", function (filePath, event) { /* ... */ });

// or run cmd

var options = { waitDone: true, stdio: [null, "pipe", "pipe"] };
var w = watch.exec(["**/*.js"], options, "echo file %relFile is changed");
w.stdout.on("data", function (data) { /* ... */ });
w.stderr.on("data", function (data) { /* ... */ });

// or run server/daemon-like cmd

var options = { throttle: 1000, stdio: [null, "inherit", "inherit"] };
var w = watch.exec(["**/*", "!node_modules/"], options, "node server.js");

```


```
watch-exec -g '**/*.js, !node_modules/' --debounce 5000 -- echo changed files: %relFiles
watch-exec -g '**/*.js, !node_modules/' -C -- echo event=%event relFile=%relFile
watch-restart -g '**/*.js,!node_modules/' --check-md5 -- node server.js
```

API:

* [watch.Watcher](#watch.Watcher) - watch files and execute callback when files are changed or listen to events
* [watch.exec(globs, options, cmd)](#watch.exec) - execute cmd when files are changed
* [watch.restart(globs, options, cmd)](#watch.restart) - run and restart cmd when files are changed

Shell commands:

* [watch-exec](#watch-exec) - shell analog of `watch.exec`
* [watch-restart](#watch-restart) - shell analog of `watch.restart`

## Features
- [x] Watch by globs, negate globs, apply globs sequentially
- [x] Compare MD5 of files
- [x] Compare mtime of files
- [x] Doesn't fire duplicate events
- [x] Handle 2-step save that is used in most of the popular editors
- [x] Execute cmd on changes
- [x] Pass file path, event, etc. to cmd
- [x] Execute cmd for each changed file in parallel
- [x] Execute cmd in queue
- [x] Restart cmd on changes
- [x] Debounce change events
- [x] Throttle cmd exec/restart
- [x] Kill processes reliably

## watch.Watcher <a name="watch.Watcher" href="#watch.Watcher">#</a>

```javascript
new watch.Watcher(globs, options, callback)
new watch.Watcher(globs, callback)
new watch.Watcher(globs)
new watch.Watcher(globs, options)
```

* `globs` `<Array>` Glob patterns to watch, see [Globs option](#globs)
* `options` `<Object>`
	* `debounce` `<integer>` Callback and events will not fire until N ms will pass from the last event, default `50`
	* `throttle` `<integer>` Call callback and fire events no more then once in N ms, default `0`
	* `reglob` `<integer>` Interval to rerun glob to check for added directories and files, default `1000`
	* `events` `<Array>` Call callback and fire events only for specified list of watch events, default `["create", "change", "delete"]`
	* `combineEvents` `<boolean>` Combine all files changes during the debounce into single event, default `true`
	* `checkMD5` `<boolean>` Check MD5 of files to prevent firing when content is not changed, default `false`
	* `checkMtime` `<boolean>` Check modified time of files, used for 2-step save, default `true`
	* `deleteCheckInterval` `<integer>` Interval to check if file is replaced, default `25`
	* `deleteCheckTimeout` `<integer>` Delay to determine if file is replaced or deleted, default `100`
	* `debug` Print debug information, default `false`
* `callback` `<Function>`

Watch files by glob. Could be used without `callback`.

Doesn't start in constructor. Call `watcher.start()` to start watching files.

**Note!** Don't forget to call `watcher.stop()` in `process.on("exit")` or `process.on(signal)` to kill all running processes before exiting.

### `globs` option <a name="globs" href="#globs">#</a>

To ignore specific pattern prefix it with '!'. To ignore directory with everything within it end pattern with '/' or '/**'.

Patterns are applied sequentially to allow for globs like:

```
	["**/*.js", "!test/", "test/test.js"]
```

For more info about glob syntax see: [glob](https://github.com/isaacs/node-glob).

### watcher.start(callback)

Start watching files. Callback is called after mathing files with glob and creating watchers.

**Note!** Changes may not be recognized rignt after the `.start` callback, `fs.watch` watchers start watching files with small delay.

### watcher.stop(callback)

Stop all watchers and clear all timers.

### watcher.stdout

Pass-through for running `cmd` stdout.

When options `.stdio[1]` is set to `'pipe'` creates pass-through stream for the running commands. Stream doesn't end when `cmd` process exits.

### watcher.stderr

Pass-through for running `cmd` stderr.

When options `.stdio[2]` is set to `'pipe'` creates pass-through stream for the running commands. Stream doesn't end when `cmd` process exits.

### Events: "create", "change", "delete"

* `file|files` `<string>|<Array>` Relative path/paths of changed files

Is emitted when file/files are created, changed or deleted.

Is not emitted when option `.combineEvents == true`

### Event: "all"

* `file|files` `<string>|<Array>` Relative paths/paths of changed files
* `event` "create", "change" or "delete"

Is emitted when file/files are created, changed or deleted.

### Event: "error"

* `err`

Is emitted when `fs` operations fail, most of the fails will not prevent watcher from working.

**Note!** Add handler to this event or it will be thrown instead.

### Event: "start"

Is called after `.start()` is finished.

### Event: "stop"

Is called after `.stop()` is finished.

## watch.exec(globs, options, cmd) <a name="watch.exec" href="#watch.exec">#</a>

Run `cmd` every time files are changed. Creates watchers immediately.

```javascript
watch.exec(globs, options, cmd)
watch.exec(globs, cmd)
```

* `globs` `<Array>` Glob patterns to watch, see [Globs option](#globs)
* `options` `<Object>`
	* All `new watch.Watcher` options
	* `waitDone` `<boolean>` Wait until `cmd` exit until executing again, default `true`
	* `parallelLimit` `<boolean>` Number of parallel running `cmd`s when `.combineEvents == false`, default `8`
	* `restartOnError` `<boolean>` Restart `cmd` if it crashed or exited with non `0` code, default `false`
	* `shell` `<boolean>|<string>` Use default shell to run `cmd`, when is string specifies custom shell, default `true`
	* `stdio` `<array`, default `[null, "ignore", "ignore"]`
	* `kill` `<Object>` Options for `kill()`, see [kill-with-style](https://github.com/wlodzislav/kill-with-style#killpid-options-callback)
* `cmd` `<string>` Command to run on changes
* Returns `<watch.Watcher>` with additional events

When option `.waitDone == true` all changes will be placed into queue, if `.combineEvents == false` uses separate queues per file.

Changes in queue are optimized, that way if there are multiple changes for the file between runs, cmd will be executed only once.

When options `.waitDone == false` current running cmd will be killed and run again, if `.combineEvents == false` kills/runs only cmd that is processing the same file that is changed.

When `.stop()` is called all running processes will be killed. Calllback is called after all processes are killed.

**Note!** Don't forget to call `watcher.stop()` in `process.on("exit")` or `process.on(signal)` to kill all running processes before exiting.

`cmd` could contain variables that will be replaced with changed file names, events, etc.

`cmd` interpolation variables:

* `%relFiles` Relative changed files paths
* `%files` Absolute changed files paths
* `%cwd` Dir to resolve relative paths

`cmd` interpolation variables with `-C, --no-combine-events`:

* `%relFile` Relative changed file path
* `%file` Absolute changed file path
* `%relDir` Relative dir containing changed file
* `%dir` Absolute dir containing changed file
* `%cwd` Dir to resolve relative paths
* `%event` File event: create, change or delete

### Event: "exec"

* `cmd` `<string>` Interpolated command

Is fired when `cmd` is run.

### Event: "exit"

* `cmd` `<string>` Interpolated command

Is fired when `cmd` is exited with any code.

### Event: "crash"

* `cmd` `<string>` Interpolated command

Is fired when `cmd` is exited with code other then `0`.

### Event: "kill"

* `cmd` `<string>` Interpolated command

Is fired when `cmd` is killed.

## watch.restart(globs, options, cmd) <a name="watch.restart" href="#watch.restart">#</a>

```javascript
watch.restart(globs, options, cmd)
watch.restart(globs, cmd)
```

Run `cmd` and restart every time files are changed. Creates watchers and runs `cmd` immediately.

* `globs` `<Array>` Glob patterns to watch, see [Globs option](#globs)
* `options` `<Object>`
	* All `new watch.Watcher` options
	* `restartOnError` `<boolean>` Restart `cmd` if it crashed or exited with non `0` code, default `true`
	* `restartOnSuccess` `<boolean>` Restart `cmd` is it exited with `0` code, default `true`
	* `shell` `<boolean>|<string>` Use default shell to run `cmd`, when is string specifies custom shell, default `true`
	* `stdio` `<array`, Parameters for child stdio in `fs.spawn`, default `[null, "ignore", "ignore"]`
	* `kill` `<Object>` Options for `kill()`, see [kill-with-style](https://github.com/wlodzislav/kill-with-style#killpid-options-callback)
* `cmd` `<string>` Command to run and restart on changes
* Returns `<watch.Watcher>` with additional events

When `.stop()` is called all running processes will be killed. Calllback is called after all processes are killed.

**Note!** Don't forget to call `watcher.stop()` in `process.on("exit")` or `process.on(signal)` to kill all running processes before exiting.

### Event: "exec"

* `cmd` `<string>`

Is fired when `cmd` is run.

### Event: "exit"

* `cmd` `<string>`

Is fired when `cmd` is exited with any code.

### Event: "crash"

* `cmd` `<string>`

Is fired when `cmd` is exited with code other then `0`.

### Event: "kill"

* `cmd` `<string>`

Is fired when `cmd` is killed.

### Event: "restart"

* `cmd` `<string>`

Is fired when `cmd` is restarted.

## watch-exec <a name="watch-exec" href="#watch-exec">#</a>

Run `<shell cmd>` every time files are changed.

If `-C, --no-combine-events` cmd will be executed for each file in parallel, debounce and throttle will be used per file.

Usage:

```
watch-exec --glob <globs> [options] -- <shell cmd>
```

Examples:

```
watch-exec -g '*.js,test/*' -- './node_modules/.bin/mocha --colors test/test.js'
watch-exec -g '**/*.js, !node_modules/' --debounce 5000 -- echo changed files: %relFiles
watch-exec -g '**/*.js, !node_modules/' -C -- echo event=%event relFile=%relFile
```

Options:

* `-g, --globs <patterns>` Glob patterns to watch, separated by comma, to ignore pattern start it with '!'
* `--events <events>` Exec only for specified events, separated by comma, possible values: create, change, delete
* `-d, --debounce <ms>` Exec cmd only after no events for N ms, default `50`
* `-t, --throttle <ms>` Exec cmd no more then once in N ms, default `0`
* `-C, --no-combine-events` Don't combine all events during debounce into single call
* `--reglob <ms>` Glob files every N ms to track added files/dirs, default `1000`
* `--check-md5` Check md5 checksum of files and fire events only if checksum is changed
* `--no-check-mtime` Don't check mtime of files and fire events only if mtime is changed
* `--parallel-limit <n>` Max number of parallel running cmds
* `-w, --wait-done` Don't kill cmd on event, queue another run after it's done
* `--restart-on-error` Restart cmd if cmd crashed or exited with non 0 code
* `--shell <shell cmd>` Custom shell to use for running cmd
* `--no-shell` Run directly without shell
* `--kill-signal <signals>` Signal to send to child when process.kill(pid, signal), separated by comma
* `--kill-timeout <ms>` After which return with error
* `--kill-retry-interval <intervals>` Intervals between sending of kill signal, separated by comma
* `--kill-retry-count <n>` Number of retries
* `--kill-check-interval <ms>` Interval between checks if process is dead
* `--kill-use-pgid` Use PGID to get all children on mac/linux
* `--kill-children-immediately` Kill children immediately, don't wait for parent to die
* `--silent` No output from watcher and running cmd
* `-v, --verbose` Log when files are changed and cmd is executed
* `-V, --version` Output version

## watch-restart <a name="watch-restart" href="#watch-restart">#</a>

Run `<shell cmd>` and restart every time files are changed.

Usage:

```
watch-restart --glob <globs> [options] -- <shell cmd>
```

Examples:

```
watch-restart -g '**/*.js,!node_modules/' node server.js");
watch-restart -g '**/*.js,!node_modules/' --debounce 500 --throttle 2000 node server.js
watch-restart -g '**/*.js,!node_modules/' --check-md5 --kill-signal 'SIGTERM,SIGTERM,SIGKILL' --kill-retry-interval '100,200,500' -- node server.js
watch-restart -g '**/*.js,!node_modules/' --shell node 'console.log(\"run\"); setInterval(()=>{}, 1000)'
```

Options:

* `-g, --globs <patterns>` Glob patterns to watch, separated by comma, to ignore pattern start it with '!'
* `--events <events>` Restart only for specified events, separated by comma, possible values: create, change, delete
* `-d, --debounce <ms>` Restart cmd only after no events for N ms, default `50`
* `-t, --throttle <ms>` Restart cmd no more then once in N ms, default `0`
* `--reglob <ms>` Glob files every N ms to track added files/dirs, default `1000`
* `--check-md5` Check md5 checksum of files and fire events only if checksum is changed
* `--no-check-mtime` Don't check mtime of files and fire events only if mtime is changed
* `--no-restart-on-error` Don't restart cmd if cmd crashed or exited with non 0 code
* `--no-restart-on-success` Don't restart cmd if cmd exited with 0 code
* `--shell <shell cmd>` Custom shell to use for running cmd
* `--no-shell` Run directly without shell
* `--kill-signal <signals>` Signal to send to child when process.kill(pid, signal), separated by comma
* `--kill-timeout <ms>` After which return with error
* `--kill-retry-interval <intervals>` Intervals between sending of kill signal, separated by comma
* `--kill-retry-count <n>` Number of retries
* `--kill-check-interval <ms>` Interval between checks if process is dead
* `--kill-use-pgid` Use PGID to get all children on mac/linux
* `--kill-children-immediately` Kill children immediately, don't wait for parent to die
* `--silent` No output from running cmd
* `-v, --verbose` Log when files are changed and cmd is restarted
* `-V, --version` Output version

