# virtconsole

A spice-html5 emergency console viewer using only one http port.

## Why?

I have a server running qemu-kvm. On occasion I need to access a guest's console.
That usually happens when 1. I do not have my laptop with virt-manager with me,
or 2. I'm in a hotel with no access to the outside world other than port 80 and 443.

So I cut&paste'd some code together, resulting in a bare console viewer. Since the Node.js
port of websockify was the easiest re-use, I made this a Node.js project.

## Requirements

- [Node.js](http://nodejs.org/).
  - [Node websockets](https://github.com/websockets/ws).
  - [Node libvirt](https://github.com/hooklift/node-libvirt).
- [Supervisor](http://supervisord.org/).
- [Nginx](http://nginx.org/), or any other webserver capable of proxying websockets.

Then there's also [spice-html5](http://www.spice-space.org/page/Html5), but I included
it's sources here.

There may be additional Node.js modules needed, but npm (or your other package manager)
should handle that for you.

## Installation

- Fetch the code.
- Install requirements.
- Create /etc/supervisor/conf.d/virtconsole:
  `[program:virtconsole]
  command=nodejs virtconsole.js  
  directory=`*`/path/to/virtconsole/`*`
  autostart=true  
  autorestart=true  
  stderr_logfile=/var/log/supervisor/virtconsole.log  
  stdout_logfile=/var/log/supervisor/virtconsole.log  
  user=`*`username`*`

## Usage

Simply make supervisord run the process:

`sudo supervisorctl start virtconsole`

What you have now is virtconsole listening on 127.0.0.1 port 8000. Not listening to
anything other than local is deliberate: No authentication and authorization has
been built in. That's what I use an nginx-proxy for.

Here are the relevant parts of my nginx configuration:

`server {
  listen [::]:443 default_server ipv6only=off;
  ssl on;
  ssl_certificate myhost.pem;
  ssl_certificate_key myhost.key;
  auth_pam 'Secret area';
  auth_pam_service_name 'nginx';
  location / {
    try_files $uri $uri/ =404;
  }
  location /terminal {
    proxy_pass http://127.0.0.1:4200;
    break;
  }
  location /console/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-for $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_connect_timeout 600;
    proxy_read_timeout 600;
    proxy_send_timeout 600;
    client_max_body_size 1024M;
}`

As you can see there's also a `/terminal` uri, proxying traffic to an application
listening to port 4200. That is [Shell In A Box](https://code.google.com/p/shellinabox/).
Virtconsole together with Shell In A Box, running behind an nginx-proxy, allow me to
do any emergency maintenance on my qemu-kvm box, even when all access I have available is
through port 443.

Except, of course, when the box itself breaks. Can't have it all.
