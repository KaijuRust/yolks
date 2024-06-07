#!/usr/bin/env node

const fs = require('fs');
const { performance } = require('perf_hooks');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;
const LokiTransport = require('winston-loki');
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

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.splat(),
        format.simple()
    ),

    transports: [
        // Write log to disk
        new transports.DailyRotateFile({
            level: 'debug',
            dirname: 'logs/',
            filename: '%DATE%-server',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '35d',
            extension: '.log',
            createSymlink: true,
            symlinkName: '../latest.log',
            format: combine(
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                printf(info => `${info.timestamp} ${info.message}`)
            ),
        }),

        // Console output
        new transports.Console({
            level: 'info',
            format: combine(
                timestamp({ format: 'HH:mm:ss' }),
                printf(info => `[${info.timestamp}] ${info.message}`)
            ),
        }),
    ],
});


//
// Loki support
//

let LOKI_ENABLED = /^(?:y|yes|true|1|on)$/i.test(String(process.env.LOKI_ENABLED ?? 'false').trim())
if (LOKI_ENABLED === true) {

    let LOKI_HOST = process.env.LOKI_HOST
    let LOKI_USERNAME = process.env.LOKI_USERNAME
    let LOKI_PASSWORD = process.env.LOKI_PASSWORD

    // Validate input
    let validConfig = [LOKI_HOST, LOKI_USERNAME, LOKI_PASSWORD].every(i => typeof i === 'string' && i.length > 0)
    if (validConfig === true) {
        // Create Loki log transport
        logger.add(
            new LokiTransport({
                level: 'debug',
                host: LOKI_HOST,
                json: true,
                batching: false,
                clearOnError: true,
                basicAuth: `${LOKI_USERNAME}:${LOKI_PASSWORD}`,
                labels: {
                    'job': 'pterodactyl_server',
                    'server_uuid': process.env.P_SERVER_UUID,
                    'server_timezone': process.env.TZ,
                    'server_memory': process.env.SERVER_MEMORY,
                    'server_ip': process.env.SERVER_IP,
                    'server_port': process.env.SERVER_PORT,
                    'server_location': process.env.P_SERVER_LOCATION,
                    'server_hostname': process.env.HOSTNAME
                },
                format: format.printf(info => `${info.message}`),
                replaceTimestamp: true,
                onConnectionError: (err) => console.error(err)
            })
        );
    }

}

function sendLog(message) {
    var processed = message.replace(/(^\s*(?!.+)\n+)|(\n+\s+(?!.+)$)/g, "").trim()
    if (processed.length === 0) return

    if (processed.startsWith('Exception thrown')) {
        logger.warning(processed)
    } else {
        logger.info(processed)
    }
}

function sendError(message) {
    var processed = message.replace(/(^\s*(?!.+)\n+)|(\n+\s+(?!.+)$)/g, "").trim()
    if (processed.length === 0) return
    logger.error(processed)
}

function sendDebug(message) {
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

function filter(data) {
	const str = data.toString();

	// Filter out fallback handler messages
	if (str.startsWith("Fallback handler could not load library")) {
	   sendDebug(str);
	   return;
	}

	// Filter shader errors and warnings
	if (str.includes("ERROR: Shader ") || str.includes("WARNING: Shader ")) {
        sendDebug(str);
        return;
	}

	// Rust seems to spam the same percentage, so filter out any duplicates.
	if (str.startsWith("Loading Prefab Bundle ")) {
		const percentage = str.substr("Loading Prefab Bundle ".length);
		if (seenPercentage[percentage]) return;

		seenPercentage[percentage] = true;
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

	sendError("Received request to stop the process, stopping the game...");

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

	ws.on("close", function () {
		if (!waiting) {
			sendError("Connection to server closed.");

			exited = true;
			process.exit(0);
		}
	});
}
poll();
