#!/usr/bin/env node

const os = require('os')
const process = require('process');
const fs = require('fs');
const { performance } = require('perf_hooks');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize } = format;
require('winston-daily-rotate-file');

//
// Validate log directory
//

if (fs.existsSync('logs/') === false) {
    fs.mkdirSync('logs/')
}

//
// Winston logger
//

const mutateMessage = format((info) => {
	switch (info.level.toUpperCase()) {
		case 'ERROR':
			info.label = "\\033[1;31m[Error]\\033[0m";
			info.message = "\\033[0;31m" + info.message + "\\033[0m";
		case 'WARNING':
			info.label = "\\033[0;38m[Warning]\\033[0m";
		case 'INFO':
			info.label = "\\033[0;34m[Info]\\033[0m";
		case 'DEBUG':
			info.label = "\\033[0;35m[Debug]\\033[0m";
	}

	return info;
 });

const logger = createLogger({
    level: 'info',
    format: format.combine(format.splat(), format.simple()),

    transports: [
        // Write log to disk
        new transports.DailyRotateFile({
            level: 'debug',
            dirname: 'logs/',
            filename: '%DATE%-server',
            datePattern: 'DD-MM-YYYY',
            maxFiles: '7d',
            extension: '.log',
            createSymlink: true,
            symlinkName: '../latest.log',
            format: combine(
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                printf(info => `${info.timestamp} ${info.label} ${info.message}`)
            ),
        }),

        // Console output
        new transports.Console({
            level: 'info',
            format: combine(
				mutateMessage(),
				colorize({  message: true, label: true }),
                timestamp({ format: 'DD-MM HH:mm:ss' }),
                printf(info => "\\033[0;37m" + info.timestamp + "\\033[0m " + info.label + " " + info.message + "\\033[0m")
            ),
        }),
    ],
});

function sendLog(input) {
    var message = input;

    // Input isn't a string
    if (typeof input !== 'string' || input instanceof String === false) {
        if (input.toString && input.toString()) {
            message = input.toString();
        } else {
            return;
        }
    }

    var processed = message.replace(/(^\s*(?!.+)\n+)|(\n+\s+(?!.+)$)/g, "").trim()
    if (processed.length === 0) return

    if (processed.startsWith('Exception thrown')) {
        logger.warning(processed)
    } else {
        logger.info(processed)
    }
}

function sendError(input) {
    var message = input;

    // Input isn't a string
    if (typeof input !== 'string' || input instanceof String === false) {
        if (input.toString && input.toString()) {
            message = input.toString();
        } else {
            return;
        }
    }

    var processed = message.replace(/(^\s*(?!.+)\n+)|(\n+\s+(?!.+)$)/g, "").trim()
    if (processed.length === 0) return


    // Add uptime to error message
    processed += `\n\t|=> Uptime: ${Math.floor(process.uptime())} seconds (OS: ${Math.floor(os.uptime())} seconds)`

    // Add load averages to error message
    processed += `\n\t|=> Load Averages: ${os.loadavg().join(', ')}`

    // Add memory to error message
    processed += `\n\t|=> Memory: Free ${os.freemem()}, Total ${os.totalmem()}`

    // Add OS cpu, total memory and free memory to error message
    processed += `\n\t|=> CPUs: ${JSON.stringify(os.cpus())}`

    // Add process memory usage to error message
    processed += `\n\t|=> Process Memory: ${JSON.stringify(process.memoryUsage())}`

    logger.error(processed)
}

function sendDebug(input) {
    var message = input;

    // Input isn't a string
    if (typeof input !== 'string' || input instanceof String === false) {
        if (input.toString && input.toString()) {
            message = input.toString();
        } else {
            return;
        }
    }

    var processed = message.replace(/(^\s*(?!.+)\n+)|(\n+\s+(?!.+)$)/g, "").trim()
    if (processed.length === 0) return
    logger.debug(processed)
}


var startupCmd = "";
var args = process.argv.splice(process.execArgv.length + 2);
for (var i = 0; i < args.length; i++) {
	if (i === args.length - 1) {
		startupCmd += args[i];
	} else {
		startupCmd += args[i] + " ";
	}
}

if (startupCmd.length < 1) {
	sendError("Error: Please specify a startup command.");
	process.exit();
}

const seenPercentage = {};
let hostnameDetected = false;

function filter(data) {
	const str = data.toString();

	// Prevent double logging after hostname is detected
	if (hostnameDetected) {
		return;  // Exit if we've already detected the hostname
	}

	// Filter out fallback handler messages
	if (str.startsWith("Fallback handler could not load library")) {
	   sendDebug(str);
	   return;
	}

	// Remove bindings.h errors
	if (str.includes("Filename:")) {
		return;
	}

	// Filter shader errors and warnings
	if (str.includes("ERROR: Shader ") || str.includes("WARNING: Shader ")) {
        sendDebug(str);
        return;
	}

	// Remove specific Behaviour script errors
	if (str.includes("The referenced script on this Behaviour")) {
		return;
	}

	// Remove RuntimeNavMeshBuilder messages
    if (str.includes("RuntimeNavMeshBuilder:")) {
		return;
	}

	// Rust seems to spam the same percentage, so filter out any duplicates.
	if (str.startsWith("Loading Prefab Bundle ")) {
		const percentage = str.substr("Loading Prefab Bundle ".length);
		if (seenPercentage[percentage]) return;

		seenPercentage[percentage] = true;
	}

    // Detect when hostname has been logged
    if (str.startsWith("hostname:")) {
        hostnameDetected = true;  // Set the flag to true after first occurrence
    }

	sendLog(str);
}

var exec = require("child_process").exec;
sendLog('Starting Rust...');

var exited = false;
const gameProcess = exec(startupCmd);
gameProcess.stdout.on('data', filter);
gameProcess.stderr.on('data', filter);
gameProcess.on('exit', function (code, signal) {
	exited = true;

	if (code) {
		sendError("Main game process exited with code " + code);
		process.exit(code);
	}
});

function initialListener(data) {
	const command = data.toString().trim();
	if (command === 'quit') {
		gameProcess.kill('SIGTERM');
	} else {
		sendLog('Unable to run "' + command + '" due to RCON not being connected yet.');
	}
}
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on('data', initialListener);

process.on('exit', function (code) {
	if (exited) return;

	sendError(`Received request to stop the process (Code: ${code}), stopping the game...`);

	gameProcess.kill('SIGTERM');
});

var waiting = true;
var pollingStartTime = undefined;

var poll = function () {
	function createPacket(command) {
		var packet = {
			Identifier: -1,
			Message: command,
			Name: "WebRcon"
		};
		return JSON.stringify(packet);
	}

	if (waiting === true && pollingStartTime == undefined) {
		pollingStartTime = performance.now();
	}

	var serverHostname = process.env.RCON_IP ? process.env.RCON_IP : "localhost";
	var serverPort = process.env.RCON_PORT;
	var serverPassword = process.env.RCON_PASS;
	var WebSocket = require("ws");
	var ws = new WebSocket("ws://" + serverHostname + ":" + serverPort + "/" + serverPassword);

	ws.on("open", function open() {
		let endTime = performance.now();
		let timeElapsed = endTime - pollingStartTime;

		var pollingDuration = Math.round(timeElapsed /= 1000);

		sendLog("Connected to RCON ("+pollingDuration+"s). Generating the map now. Please wait until the server status switches to \"Running\".");

		waiting = false;
		pollingStartTime = undefined;

		// Hack to fix broken console output
		ws.send(createPacket('status'));

		process.stdin.removeListener('data', initialListener);
		gameProcess.stdout.removeListener('data', filter);
		gameProcess.stderr.removeListener('data', filter);
		process.stdin.on('data', function (text) {
		    sendLog(`Transmitting console input: ${text}`);
			ws.send(createPacket(text));
		});
	});

	ws.on("message", function (data, flags) {
		try {
			var json = JSON.parse(data);
			if (json !== undefined) {
				if (json.Message !== undefined && json.Message.length > 0) {
					sendLog(json.Message);
				}
			} else {
				sendError("Error: Invalid JSON received");
			}
		} catch (e) {
			if (e) {
				sendError(e);
			}
		}
	});

	ws.on("error", function (err) {
		waiting = true;

		let endTime = performance.now();
		let timeElapsed = endTime - pollingStartTime;

		var pollingDuration = Math.round(timeElapsed /= 1000);

		// If the server is taking too long to start, we should exit.
		if (pollingDuration > 900) {
			sendError("RCON server took too long (15 minutes) to start. Exiting...");

			gameProcess.kill("SIGKILL");
			process.exit(1);
		}

		sendLog("Waiting for RCON to come up... (" + pollingDuration + "s)");
		setTimeout(poll, 5000);
	});

	ws.on("close", function (ws, code, reason) {
		if (!waiting) {
			sendError(`Connection to server closed. (Code: ${code}, Reason: ${(reason) ? reason.toString() ?? reason : 'no reason'})`);

			exited = true;
			process.exit(0);
		}
	});
}
poll();
