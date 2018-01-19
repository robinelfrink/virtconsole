import base64
import libvirt
import os.path
import re
import socket
import tornado.ioloop
import tornado.web
import tornado.websocket


DOMAINS = {}


class HtmlHandler(tornado.web.RequestHandler):

    def get(self, abspath, start=None, end=None):
        with open(os.path.join(os.path.dirname(__file__), 'virtconsole.html'), 'rb') as file:
            content = file.read()
        elements = []
        for name in sorted(DOMAINS.keys()):
            elements.append('<li id="domain-%s"><a href="#" onclick="return connect(\'%s\');">%s</a></li>' % (name, name, name))
        self.write(re.sub(r'{domains}', ''.join(elements), content))


class ProxyServer(object):

    def __init__(self, port, client=None):
        self.port = port
        self.client = client
        self.stream = None
        self.sock_fd = None

    def connect(self):
        self.sock_fd = socket.socket(socket.AF_INET, socket.SOCK_STREAM, 0)
        self.stream = tornado.iostream.IOStream(self.sock_fd)
        self.stream.set_close_callback(self.on_close)
        self.stream.connect(('127.0.0.1', self.port), self.read)

    def on_receive(self, data):
        self.stream.read_bytes(1024, streaming_callback=self.on_streaming, callback=self.on_receive)

    def on_streaming(self, data):
        if self.client.subprotocol=='base64':
            self.client.write_message(base64.b64encode(data))
        else:
            self.client.write_message(data, binary=True)

    def read(self):
        self.stream.read_bytes(1024, streaming_callback=self.on_streaming, callback=self.on_receive)

    def on_close(self):
        if self.client:
            self.client.close()

    def write(self, msg):
        self.stream.write(msg)

    def close(self):
        self.stream.close()


class WebSocketHandler(tornado.websocket.WebSocketHandler):

    clients = set()
    stream_map = {}

    def check_origin(self, domain):
        return True

    def select_subprotocol(self, subprotocols):
        if 'binary' in subprotocols:
            self.subprotocol = 'binary'
        elif 'base64' in subprotocols:
            self.subprotocol = 'base64'
        return self.subprotocol

    def open(self, domain):
        WebSocketHandler.clients.add(self)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM, 0)
        c = ProxyServer(DOMAINS[domain]['port'], self)
        self.target = ProxyServer(DOMAINS[domain]['port'], client=self)
        WebSocketHandler.stream_map[self] = c
        c.connect()

    def on_message(self, message):
        st = WebSocketHandler.stream_map[self]
        if self.subprotocol=='base64':
            st.write(base64.b64decode(message))
        else:
            st.write(message)

    def on_close(self):
        WebSocketHandler.clients.remove(self)
        if WebSocketHandler.stream_map.get(self):
            st = WebSocketHandler.stream_map[self]
            st.close()
            del WebSocketHandler.stream_map[self]


if __name__ == '__main__':

    hypervisor = libvirt.openReadOnly('qemu:///system')
    for id in hypervisor.listDomainsID():
        domain = hypervisor.lookupByID(id)
        xml = domain.XMLDesc()
        # A dirty hack, but it's all we have for now.
        port = re.sub(r".*<graphics type='spice' port='([0-9]+)' .*", r'\1', xml, flags=re.DOTALL)
        DOMAINS[domain.name()] = { 'id': id, 'port': int(port) }

    app = tornado.web.Application([
        (r'/(virtconsole\.html)?', HtmlHandler),
        (r'/+domain/(.*)', WebSocketHandler),
        (r'/(.*)', tornado.web.StaticFileHandler, {
            'path': os.path.dirname(__file__),
        }),
    ])
    app.listen(8000)
    tornado.ioloop.IOLoop.current().start()
