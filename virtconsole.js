var Buffer = require('buffer').Buffer,
    fs = require('fs'),
    http = require('http'),
    net = require('net'),
    path = require('path'),
    url = require('url'),
    libvirt = require('/usr/lib/nodejs/libvirt/lib/libvirt.node'),
    WebSocketServer = require('ws').Server;

var hypervisor = new libvirt.Hypervisor('qemu:///system');

/* Fetch active domains using libvirt. */
var domains;
function updatedomains() {
    var activedomains = hypervisor.getActiveDomains();
    var unsorteddomains = {};
    var domainnames = [];
    for (i=0; i<activedomains.length; i++) {
        domain = hypervisor.lookupDomainById(activedomains[i]);
        var xml = domain.toXml([ libvirt.VIR_DOMAIN_XML_SECURE, libvirt.VIR_DOMAIN_XML_INACTIVE ]);
        /* A dirty hack, but it's all we have for now. */
        var port = xml.replace(/[.\s\S]*<graphics type='spice' port='([0-9]+)' [.\s\S]*/m, '$1');
        unsorteddomains[domain.getName()] = { id: activedomains[i], port: port };
        domainnames.push(domain.getName());
    }
    domainnames.sort();
    domains = {};
    for (i=0; i<domainnames.length; i++)
        domains[domainnames[i]] = unsorteddomains[domainnames[i]];
}

/* Create the li-elements for the html. */
function domainelements(domains) {
    var elements = '';
    var base = '<li id="domain-{name}"><a href="#" onclick="return connect(\'{name}\');">{name}</a></li>';
    for (var name in domains)
        elements = elements+base.replace(/{name}/g, name);
    return elements;
}

var selectprotocol = function(protocols, callback) {
    if (protocols.indexOf('binary')>=0) {
        callback(true, 'binary');
    } else if (protocols.indexOf('base64')>=0) {
        callback(true, 'base64');
    } else {
        console.log('Client must support binary or base64.');
        callback(false);
    }
}

var handleclient = function(client) {
    console.log('Socket client, uri: '+client.upgradeReq.url);
    console.log('Version '+client.protocolVersion+', subprotocol: '+client.protocol);
    if (client.upgradeReq.url.match(/^\/domain\//)) {
        domain = client.upgradeReq.url.replace(/.*\//, '');
        console.log('Connecting to domain '+domain);
        var target = net.createConnection({
            port: domains[domain]['port'],
            host: '127.0.0.1'
        }, function() {
            console.log('Connected to localhost:'+domains[domain]['port']);
        });
        target.on('data', function(data) {
            try {
                if (client.protocol==='base64')
                    client.send(new Buffer(data).toString('base64'));
                else
                    client.send(data, { binary: true });
            } catch (exception) {
                console.log('Server closed connection.');
                target.end();
            }
        });
        target.on('end', function() {
            console.log('Server closed connection.');
            client.close();
        });
        target.on('error', function() {
            console.log('Server error.');
            target.end();
            client.close();
        });
        client.on('message', function(message) {
            if (client.protocol==='base64')
                target.write(new Buffer(message, 'base64'));
            else
                target.write(message, 'binary');
        });
        client.on('close', function(code, reason) {
            console.log('Client closed connection: '+code+' ('+reason+')');
            target.end();
        });
        client.on('error', function(error) {
            console.log('Client error: '+error);
            target.end();
        });
    }
};

var handlerequest = function(request, response) {
    var uri = url.parse(request.url).pathname.replace(/^\/?$/, 'virtconsole.html').replace(/^\//, '');
    var file = path.join('spice-html5', uri);
    if (uri.match(/^virtconsole\.(html|css)$/))
        file = uri;
    fs.exists(file, function(exists) {
        if (!exists) {
            console.log('File not found: '+file);
            response.writeHead(404, { 'Content-Type': 'text/plain' });
            response.write('404 Not Found\n');
            response.end();
            return;
        }
        fs.readFile(file, 'binary', function(error, data) {
            if (error) {
                response.writeHead(500, { 'Content-Type': 'text/plain' });
                response.write(error + '\n');
                response.end();
                return;
            }
            if (file=='virtconsole.html')
                data = data.replace(/{domains}/, domainelements(domains));
            response.writeHead(200);
            response.write(data, 'binary');
            response.end();
        });
    });
};

updatedomains();

var webserver = http.createServer(handlerequest);
webserver.listen(8000, '127.0.0.1', function() {
    socketserver = new WebSocketServer({
        server: webserver,
        handleProtocols: selectprotocol
    });
    socketserver.on('connection', handleclient);
});

