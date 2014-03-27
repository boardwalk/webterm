
// serve static files
var express = require('express');
app = express();
app.use(express.static(__dirname + '/static'));
app.listen(8080);

var ws = require('ws');
var wsServer = new ws.Server({port: 8081});
var pty = require('pty.js');

wsServer.on('connection', function(ws) {
    term = pty.spawn('env', ['TERM=xterm-256color', 'bash', '-l']);

    term.on('data', function(data) {
        //console.log('data received from terminal: ' + data);
        ws.send(data);
    });

    ws.on('message', function(message) {
        //console.log('message received from websocket: ' + message);
        term.write(message);
    });

    ws.on('close', function() {
        console.log('websocket closed');
        term.destroy();
    });
});

