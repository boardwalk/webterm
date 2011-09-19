#!/bin/sh
thin --ssl --ssl-key-file server.key --ssl-cert-file server.crt -R config.ru start
